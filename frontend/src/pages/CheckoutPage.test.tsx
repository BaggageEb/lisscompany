import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CheckoutPage } from './CheckoutPage';
import { addCartLine, getCart, type ProductCartLine } from '../lib/cart';
import { refreshSession } from '../lib/session';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const USER = { id: 'u1', email: 'ana@example.com', displayName: 'Ana Compradora', phone: '912345678' };

const QUOTE = {
  valid: true,
  total: '3500.00',
  currency: 'AOA',
  lines: [
    {
      kind: 'PRODUCT',
      name: 'Bolo no Pote Premium',
      unitPrice: '3500.00',
      quantity: 1,
      lineTotal: '3500.00',
      valid: true,
      issues: [],
    },
  ],
  issues: [],
};

const ORDER = {
  number: 'LC-000001',
  status: 'RECEIVED',
  createdAt: '2026-10-20T12:00:00Z',
  fulfillment: 'PICKUP',
  paymentMethod: 'ON_DELIVERY',
  contactName: 'Ana Compradora',
  contactPhone: '912345678',
  subtotal: '3500.00',
  deliveryFee: '0.00',
  discountAmount: '0.00',
  discountLabel: null,
  pointsSpent: 0,
  total: '3500.00',
  currency: 'AOA',
  items: [
    {
      kind: 'PRODUCT',
      name: 'Bolo no Pote Premium',
      unitPrice: '3500.00',
      quantity: 1,
      lineTotal: '3500.00',
      summary: [],
    },
  ],
};

/** Encomenda com o desconto de pontos que o servidor confirmou. */
const ORDER_DISCOUNTED = {
  ...ORDER,
  subtotal: '3500.00',
  discountAmount: '1000.00',
  discountLabel: 'Pontos de fidelização',
  pointsSpent: 1000,
  total: '2500.00',
};

const LOYALTY_UNCONFIGURED = {
  configured: false,
  active: false,
  pointsBalance: 0,
  lifetimePoints: 0,
  earnPercent: null,
  pointValueKz: null,
  rounding: null,
  allowPartialRedemption: null,
  welcome: null,
  rewards: [],
};

const LOYALTY_ACTIVE = {
  configured: true,
  active: true,
  pointsBalance: 2000,
  lifetimePoints: 2000,
  earnPercent: '10.00',
  pointValueKz: '1.0000',
  rounding: 'HALF_UP',
  allowPartialRedemption: true,
  welcome: null,
  rewards: [],
};

const REWARD_STATUS = {
  reward: {
    code: 'GOAL_5K',
    description: 'Recompensa de meta',
    minPoints: 1000,
    minOrders: 1,
    discountAmount: '1000.00',
    maxPerCustomer: 1,
    active: true,
  },
  eligible: true,
  reason: null,
  redeemedCount: 0,
};

function productLine(overrides: Partial<ProductCartLine> = {}): ProductCartLine {
  return {
    kind: 'PRODUCT',
    productId: 'p1',
    slug: 'bolo-no-pote-premium',
    name: 'Bolo no Pote Premium',
    unitPrice: '3500.00',
    quantity: 1,
    imageUrl: null,
    ...overrides,
  };
}

function renderCheckout() {
  return render(
    <MemoryRouter initialEntries={['/checkout']}>
      <Routes>
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/entrar" element={<p>Ecrã de login</p>} />
        <Route path="/carrinho" element={<p>Ecrã do carrinho</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Encaminha por URL o que o cliente de API pede. */
function mockApi(handlers: {
  me?: unknown;
  order?: (body: string) => Response;
  loyalty?: unknown;
}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url === '/api/v1/csrf') return json({ token: 'token-1' });
    if (url === '/api/v1/auth/me') {
      return handlers.me === undefined ? json({}, 401) : json(handlers.me);
    }
    if (url === '/api/v1/public/cart/quote') return json(QUOTE);
    if (url === '/api/v1/loyalty') return json(handlers.loyalty ?? LOYALTY_UNCONFIGURED);
    if (url === '/api/v1/loyalty/transactions') return json([]);
    if (url === '/api/v1/orders' && method === 'POST') {
      return handlers.order
        ? handlers.order(String(init?.body ?? ''))
        : json(ORDER, 201);
    }
    throw new Error('pedido inesperado: ' + method + ' ' + url);
  });
}

async function signIn() {
  mockApi({ me: USER });
  await refreshSession();
}

async function fillContactAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('radio', { name: /pagamento na entrega/i }));
  await user.click(screen.getByRole('button', { name: 'Registar encomenda' }));
}

describe('CheckoutPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('sem conta mostra o convite para entrar em vez do formulário', async () => {
    mockApi({}); // /me responde 401 → anónimo
    await refreshSession();
    renderCheckout();

    expect(await screen.findByRole('button', { name: 'Entrar para continuar' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /criar conta/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/nome de quem recebe/i)).not.toBeInTheDocument();
  });

  it('com conta cria a encomenda com o total do servidor e limpa o carrinho', async () => {
    addCartLine(productLine());
    await signIn();
    mockApi({});
    const user = userEvent.setup();
    renderCheckout();

    // Contacto pré-preenchido do perfil.
    expect(await screen.findByLabelText(/nome de quem recebe/i)).toHaveValue('Ana Compradora');
    expect(screen.getByLabelText(/^telefone/i)).toHaveValue('912345678');

    // Total confirmado pelo servidor antes de submeter (aparece no resumo).
    expect((await screen.findAllByText(/3\s?500,00\s*Kz/)).length).toBeGreaterThan(0);

    await fillContactAndSubmit(user);

    expect(await screen.findByText('LC-000001')).toBeInTheDocument();
    expect(screen.getByText(/encomenda registada/i)).toBeInTheDocument();
    await waitFor(() => expect(getCart().lines).toHaveLength(0));
  });

  it('sem programa configurado diz a verdade e não oferece pontos', async () => {
    addCartLine(productLine());
    await signIn();
    mockApi({});
    renderCheckout();

    await screen.findByText(/nome de quem recebe/i);
    expect(
      screen.getByText(/o programa de fidelização ainda não está activo/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Usar os meus pontos')).not.toBeInTheDocument();
  });

  it('com programa activo usa pontos: envia o resgate e a confirmação mostra o desconto', async () => {
    addCartLine(productLine());
    await signIn();
    let submittedBody = '';
    mockApi({
      loyalty: LOYALTY_ACTIVE,
      order: (body) => {
        submittedBody = body;
        return json(ORDER_DISCOUNTED, 201);
      },
    });
    const user = userEvent.setup();
    renderCheckout();

    await screen.findByText(/nome de quem recebe/i);
    // Activar o resgate: o campo pré-preenche o saldo total (resgate parcial).
    await user.click(screen.getByLabelText('Usar os meus pontos'));
    const pointsInput = screen.getByLabelText('Quantos pontos usar') as HTMLInputElement;
    expect(pointsInput.value).toBe('2000');
    await user.clear(pointsInput);
    await user.type(pointsInput, '1000');
    // A estimativa aparece rotulada — o servidor continua a ser a autoridade.
    expect(screen.getByText(/desconto estimado/i)).toBeInTheDocument();

    await fillContactAndSubmit(user);

    expect(await screen.findByText('LC-000001')).toBeInTheDocument();
    const body = JSON.parse(submittedBody) as Record<string, unknown>;
    expect(body.pointsToSpend).toBe(1000);
    expect(body.rewardCode).toBeUndefined();
    // A confirmação mostra o desconto REAL que o servidor gravou.
    expect(screen.getByText(/pontos de fidelização/i)).toBeInTheDocument();
    expect(screen.getByText(/1\s?000,00\s*Kz/)).toBeInTheDocument();
  });

  it('recompensa elegível é escolhida pelo código e enviada ao servidor', async () => {
    addCartLine(productLine());
    await signIn();
    let submittedBody = '';
    mockApi({
      loyalty: { ...LOYALTY_ACTIVE, rewards: [REWARD_STATUS] },
      order: (body) => {
        submittedBody = body;
        return json({ ...ORDER_DISCOUNTED, discountLabel: 'Recompensa de meta' }, 201);
      },
    });
    const user = userEvent.setup();
    renderCheckout();

    await screen.findByText(/nome de quem recebe/i);
    await user.click(screen.getByLabelText('Recompensa de meta'));
    await fillContactAndSubmit(user);

    await screen.findByText('LC-000001');
    const body = JSON.parse(submittedBody) as Record<string, unknown>;
    expect(body.rewardCode).toBe('GOAL_5K');
    expect(body.pointsToSpend).toBeUndefined();
  });

  it('quando o servidor rejeita o carrinho (422) mostra os motivos e mantém o carrinho', async () => {
    addCartLine(productLine());
    await signIn();
    mockApi({
      order: () =>
        json(
          {
            status: 422,
            code: 'CART_INVALID',
            message: 'O carrinho deixou de ser válido. Corrija os artigos indicados e tente novamente.',
            path: '/api/v1/orders',
            fieldErrors: {},
            issues: ['Produto: já não está disponível.'],
          },
          422,
        ),
    });
    const user = userEvent.setup();
    renderCheckout();

    await screen.findByText(/nome de quem recebe/i);
    await fillContactAndSubmit(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Produto: já não está disponível.');
    expect(screen.getByRole('link', { name: /rever carrinho/i })).toHaveAttribute('href', '/carrinho');
    // O carrinho NÃO é limpo quando o servidor rejeita.
    expect(getCart().lines).toHaveLength(1);
  });
});
