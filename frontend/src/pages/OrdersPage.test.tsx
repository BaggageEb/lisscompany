import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { OrdersPage } from './OrdersPage';
import { resetSession, refreshSession } from '../lib/session';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const USER = { id: 'u1', email: 'ana@example.com', displayName: 'Ana Compradora', phone: null };

const ORDERS = [
  {
    number: 'LC-000001',
    status: 'RECEIVED',
    paymentStatus: 'PENDING',
    createdAt: '2026-10-20T12:00:00Z',
    total: '7000.00',
    currency: 'AOA',
    itemCount: 2,
  },
  {
    number: 'LC-000002',
    status: 'COMPLETED',
    paymentStatus: 'PAID',
    createdAt: '2026-10-01T09:30:00Z',
    total: '12000.00',
    currency: 'AOA',
    itemCount: 1,
  },
];

/** Encaminha por URL o que o cliente de API pede. */
function mockApi(handlers: { me?: unknown; orders?: () => Response }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url === '/api/v1/csrf') return json({ token: 'token-1' });
    if (url === '/api/v1/auth/me') {
      return handlers.me === undefined ? json({}, 401) : json(handlers.me);
    }
    if (url === '/api/v1/orders') {
      return handlers.orders ? handlers.orders() : json(ORDERS);
    }
    throw new Error('pedido inesperado: ' + url);
  });
}

function renderOrders() {
  return render(
    <MemoryRouter initialEntries={['/conta/encomendas']}>
      <Routes>
        <Route path="/conta/encomendas" element={<OrdersPage />} />
        <Route path="/entrar" element={<p>Ecrã de login</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('OrdersPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetSession();
  });

  it('sem sessão mostra o convite para entrar e não pede a lista', async () => {
    const spy = mockApi({}); // /me → 401
    await refreshSession();
    renderOrders();

    expect(await screen.findByRole('button', { name: /entrar para ver encomendas/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /criar conta/i })).toBeInTheDocument();
    await waitFor(() => {
      const askedOrders = spy.mock.calls.some(([input]) => String(input) === '/api/v1/orders');
      expect(askedOrders).toBe(false);
    });
  });

  it('lista as encomendas com estados de encomenda e de pagamento', async () => {
    mockApi({ me: USER });
    await refreshSession();
    renderOrders();

    expect(await screen.findByText('LC-000001')).toBeInTheDocument();
    expect(screen.getByText('LC-000002')).toBeInTheDocument();
    // Estado da encomenda e do pagamento, traduzidos do servidor.
    expect(screen.getAllByText('Recebida').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pagamento: Por confirmar').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Concluída').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pagamento: Pago').length).toBeGreaterThan(0);
    // Total formatado em Kz.
    expect(screen.getAllByText(/7\s?000,00\s*Kz/).length).toBeGreaterThan(0);
    // Cada cartão liga ao detalhe.
    const links = screen.getAllByRole('link');
    expect(links.some((a) => a.getAttribute('href') === '/conta/encomendas/LC-000001')).toBe(true);
  });

  it('sem encomendas mostra o estado vazio com saída para a loja', async () => {
    mockApi({ me: USER, orders: () => json([]) });
    await refreshSession();
    renderOrders();

    expect(await screen.findByText('Ainda não tem encomendas')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ir para a loja/i })).toHaveAttribute('href', '/loja');
  });

  it('falha de rede mostra o erro e a nova tentativa recarrega', async () => {
    const user = userEvent.setup();
    let fail = true;
    mockApi({
      me: USER,
      orders: () => {
        if (fail) {
          fail = false;
          return json({ status: 500, code: 'INTERNAL_ERROR', message: 'Erro interno.', path: '/api/v1/orders' }, 500);
        }
        return json(ORDERS);
      },
    });
    await refreshSession();
    renderOrders();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Erro interno.');

    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('LC-000001')).toBeInTheDocument();
  });
});
