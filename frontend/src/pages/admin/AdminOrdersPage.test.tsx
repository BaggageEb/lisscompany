import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AdminLayout } from './AdminLayout';
import { AdminOrdersPage } from './AdminOrdersPage';
import { AdminOrderDetailPage } from './AdminOrderDetailPage';
import { resetSession, refreshSession } from '../../lib/session';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const CUSTOMER = { id: 'u1', email: 'cliente@example.com', displayName: 'Ana Cliente', phone: null };
const OWNER = { ...CUSTOMER, email: 'dona@example.com', owner: true };

const ORDER = {
  number: 'LC-000001',
  status: 'RECEIVED',
  paymentStatus: 'PENDING',
  createdAt: '2026-10-22T10:00:00Z',
  total: '3500.00',
  currency: 'AOA',
  itemCount: 1,
  contactName: 'Cliente Teste',
  fulfillment: 'PICKUP',
  paymentMethod: 'IBAN_TRANSFER',
};

const DETAIL = {
  order: {
    number: 'LC-000001',
    status: 'RECEIVED',
    paymentStatus: 'PENDING',
    createdAt: '2026-10-22T10:00:00Z',
    fulfillment: 'PICKUP',
    paymentMethod: 'IBAN_TRANSFER',
    contactName: 'Cliente Teste',
    contactPhone: '912345678',
    notes: 'Sem velas.',
    addressLine1: null,
    addressLine2: null,
    addressCity: null,
    addressMunicipality: null,
    subtotal: '3500.00',
    deliveryFee: '0.00',
    discountAmount: '0.00',
    discountLabel: null,
    pointsSpent: 0,
    total: '3500.00',
    currency: 'AOA',
    items: [
      { kind: 'PRODUCT', name: 'Bolo no Pote', unitPrice: '3500.00', quantity: 1, lineTotal: '3500.00', summary: [] },
    ],
  },
  allowedTargets: ['CANCELLED', 'CONFIRMED'],
};

/** Encaminha por URL/método os pedidos do painel. */
function mockApi(handlers: {
  me?: unknown;
  orders?: () => Response;
  detail?: () => Response;
  transition?: () => Response;
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
    if (url.startsWith('/api/v1/admin/orders/') && method === 'POST') {
      return handlers.transition ? handlers.transition() : json(DETAIL.order);
    }
    if (url.startsWith('/api/v1/admin/orders/')) {
      return handlers.detail ? handlers.detail() : json(DETAIL);
    }
    if (url.startsWith('/api/v1/admin/orders')) {
      return handlers.orders ? handlers.orders() : json([ORDER]);
    }
    throw new Error('pedido inesperado: ' + method + ' ' + url);
  });
  return calls;
}

function renderOrders() {
  return render(
    <MemoryRouter initialEntries={['/admin/encomendas']}>
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route path="encomendas" element={<AdminOrdersPage />} />
          <Route path="encomendas/:number" element={<AdminOrderDetailPage />} />
          <Route path="pagamentos" element={<p>Painel de pagamentos</p>} />
          <Route path="inventario" element={<p>Painel de inventário</p>} />
          <Route path="fidelizacao" element={<p>Painel de fidelização</p>} />
        </Route>
        <Route path="/entrar" element={<p>Ecrã de login</p>} />
        <Route path="/conta" element={<p>Área do cliente</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('painel: guarda + lista de encomendas', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetSession();
  });

  it('sem sessão convida para entrar em vez de mostrar o painel', async () => {
    mockApi({});
    await refreshSession();
    renderOrders();

    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect(screen.queryByText('LC-000001')).not.toBeInTheDocument();
  });

  it('sessão de cliente comum diz honestamente que não há permissão', async () => {
    mockApi({ me: CUSTOMER });
    await refreshSession();
    renderOrders();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('A sua conta não tem permissão para o painel');
    expect(screen.queryByText('LC-000001')).not.toBeInTheDocument();
  });

  it('dona vê a lista, filtra pelo servidor e abre o detalhe', async () => {
    const user = userEvent.setup();
    const calls = mockApi({ me: OWNER });
    await refreshSession();
    renderOrders();

    expect(await screen.findByText('LC-000001')).toBeInTheDocument();
    expect(screen.getByText(/Cliente Teste/)).toBeInTheDocument();

    // Filtro: o pedido leva os parâmetros ao servidor (o backend decide).
    await user.selectOptions(screen.getByLabelText('Estado da encomenda'), 'RECEIVED');
    await waitFor(() => {
      expect(calls.some((call) => call.url.includes('/api/v1/admin/orders?status=RECEIVED'))).toBe(true);
    });

    // Navegação para o detalhe.
    await user.click(screen.getByRole('link', { name: 'LC-000001' }));
    expect(await screen.findByText('Sem velas.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar encomenda' })).toBeInTheDocument();
  });

  it('transição válida é enviada ao servidor e o detalhe recarrega', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      me: OWNER,
      transition: () => json({ ...DETAIL.order, status: 'CONFIRMED' }),
    });
    await refreshSession();
    renderOrders();

    await screen.findByText('LC-000001');
    await user.click(screen.getByRole('link', { name: 'LC-000001' }));
    await screen.findByRole('button', { name: 'Confirmar encomenda' });

    await user.click(screen.getByRole('button', { name: 'Confirmar encomenda' }));

    await waitFor(() => {
      const transition = calls.find(
        (call) => call.method === 'POST' && call.url.includes('/api/v1/admin/orders/LC-000001/status'),
      );
      expect(transition).toBeDefined();
      expect(JSON.parse(transition!.body ?? '{}')).toMatchObject({ target: 'CONFIRMED' });
    });
  });

  it('erro do servidor no painel mostra alerta com nova tentativa', async () => {
    mockApi({
      me: OWNER,
      orders: () =>
        json({ status: 500, code: 'INTERNAL', message: 'Falha de base de dados simulada.', path: '/api/v1/admin/orders' }, 500),
    });
    await refreshSession();
    renderOrders();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Falha de base de dados simulada.');
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });
});
