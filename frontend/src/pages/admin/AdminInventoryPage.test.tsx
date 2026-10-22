import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AdminInventoryPage } from './AdminInventoryPage';
import { resetSession, refreshSession } from '../../lib/session';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const OWNER = { id: 'u1', email: 'dona@example.com', displayName: 'Dona', phone: null, owner: true };

const STOCK = [
  { productId: 'p1', productName: 'Bolo no Pote Premium', availableQty: 10, reservedQty: 2, unitLabel: 'un' },
];

const PRODUCTS = [
  {
    id: 'p1',
    slug: 'bolo-no-pote-premium',
    name: 'Bolo no Pote Premium',
    description: 'Clássico',
    basePrice: '3500.00',
    currency: 'AOA',
    categorySlug: 'bolos',
    categoryName: 'Bolos',
    available: true,
  },
  {
    id: 'p2',
    slug: 'caixa-degustacao',
    name: 'Caixa de Degustação',
    description: 'Seis potes',
    basePrice: '9000.00',
    currency: 'AOA',
    categorySlug: 'caixas',
    categoryName: 'Caixas',
    available: true,
  },
];

function mockApi(handlers: {
  me?: unknown;
  stock?: () => Response;
  adjust?: () => Response;
  withUnmanaged?: boolean;
}) {
  const calls: { url: string; method: string; body?: string }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({ url, method, ...(body ? { body } : {}) });
    if (url === '/api/v1/csrf') return json({ token: 'token-1' });
    if (url === '/api/v1/auth/me') {
      return handlers.me === undefined ? json({}, 401) : json(handlers.me);
    }
    if (url.includes('/adjustment') && method === 'POST') {
      return handlers.adjust ? handlers.adjust() : json({ ...STOCK[0], availableQty: 30 });
    }
    if (url === '/api/v1/admin/inventory') {
      return handlers.stock ? handlers.stock() : json(STOCK);
    }
    if (url === '/api/v1/public/catalog/products') {
      return json(handlers.withUnmanaged ? PRODUCTS : PRODUCTS.slice(0, 1));
    }
    throw new Error('pedido inesperado: ' + method + ' ' + url);
  });
  return calls;
}

function renderInventory() {
  return render(
    <MemoryRouter initialEntries={['/admin/inventario']}>
      <Routes>
        <Route path="/admin/inventario" element={<AdminInventoryPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('painel: inventário', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetSession();
  });

  it('ajuste manual é enviado ao servidor e o resultado aparece', async () => {
    const user = userEvent.setup();
    const calls = mockApi({ me: OWNER });
    await refreshSession();
    renderInventory();

    expect(await screen.findByText('Bolo no Pote Premium')).toBeInTheDocument();
    expect(screen.getByText(/Disponível: 10 un · Reservado: 2/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Ajustar stock' }));
    await user.type(screen.getByLabelText(/Unidades/), '20');
    await user.type(screen.getByLabelText(/Nota \(opcional\)/), 'Reconto do armazém.');
    await user.click(screen.getByRole('button', { name: 'Guardar ajuste' }));

    await waitFor(() => {
      const post = calls.find(
        (call) => call.method === 'POST' && call.url.includes('/api/v1/admin/inventory/p1/adjustment'),
      );
      expect(post).toBeDefined();
      expect(JSON.parse(post!.body ?? '{}')).toMatchObject({ delta: 20, note: 'Reconto do armazém.' });
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Bolo no Pote Premium: 30 un em stock');
  });

  it('delta zero é recusado no cliente sem pedido ao servidor', async () => {
    const user = userEvent.setup();
    const calls = mockApi({ me: OWNER });
    await refreshSession();
    renderInventory();

    await screen.findByText('Bolo no Pote Premium');
    await user.click(screen.getByRole('button', { name: 'Ajustar stock' }));
    await user.type(screen.getByLabelText(/Unidades/), '0');
    await user.click(screen.getByRole('button', { name: 'Guardar ajuste' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/não pode ser zero/i);
    expect(calls.some((call) => call.method === 'POST' && call.url.includes('/adjustment'))).toBe(false);
  });

  it('erro 400 do servidor (campo) aparece no alerta', async () => {
    const user = userEvent.setup();
    mockApi({
      me: OWNER,
      adjust: () =>
        json(
          {
            status: 400,
            code: 'VALIDATION_FAILED',
            message: 'Dados inválidos.',
            path: '/api/v1/admin/inventory/p1/adjustment',
            fieldErrors: { delta: 'Ajuste demasiado grande (máximo 1 000 000 unidades por movimento).' },
          },
          400,
        ),
    });
    await refreshSession();
    renderInventory();

    await screen.findByText('Bolo no Pote Premium');
    await user.click(screen.getByRole('button', { name: 'Ajustar stock' }));
    await user.type(screen.getByLabelText(/Unidades/), '9999999');
    await user.click(screen.getByRole('button', { name: 'Guardar ajuste' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Ajuste demasiado grande');
  });

  it('produtos sem linha de stock aparecem no bloco de quantidade inicial', async () => {
    const user = userEvent.setup();
    const calls = mockApi({ me: OWNER, withUnmanaged: true });
    await refreshSession();
    renderInventory();

    await screen.findByText('Adicionar produto ao inventário');
    await user.selectOptions(screen.getByLabelText('Produto'), 'p2');
    await user.type(screen.getByLabelText('Quantidade inicial'), '40');
    await user.click(screen.getByRole('button', { name: 'Criar quantidade inicial' }));

    await waitFor(() => {
      const post = calls.find(
        (call) => call.method === 'POST' && call.url.includes('/api/v1/admin/inventory/p2/adjustment'),
      );
      expect(post).toBeDefined();
      expect(JSON.parse(post!.body ?? '{}')).toMatchObject({ delta: 40 });
    });
  });
});
