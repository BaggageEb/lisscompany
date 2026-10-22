import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { OrderDetailPage } from './OrderDetailPage';
import { resetSession, refreshSession } from '../lib/session';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const USER = { id: 'u1', email: 'ana@example.com', displayName: 'Ana Compradora', phone: null };

const ORDER = {
  number: 'LC-000001',
  status: 'RECEIVED',
  paymentStatus: 'PENDING',
  createdAt: '2026-10-20T12:00:00Z',
  fulfillment: 'PICKUP',
  paymentMethod: 'IBAN_TRANSFER',
  contactName: 'Ana Compradora',
  contactPhone: '912345678',
  notes: 'Sem velas, por favor.',
  addressLine1: null,
  addressLine2: null,
  addressCity: null,
  addressMunicipality: null,
  subtotal: '7000.00',
  deliveryFee: '0.00',
  discountAmount: '0.00',
  discountLabel: null,
  pointsSpent: 0,
  total: '7000.00',
  currency: 'AOA',
  items: [
    { kind: 'PRODUCT', name: 'Bolo no Pote Premium', unitPrice: '3500.00', quantity: 2, lineTotal: '7000.00', summary: [] },
  ],
};

/** Encaminha por URL o que o cliente de API pede. */
function mockApi(handlers: {
  me?: unknown;
  order?: () => Response;
  cancel?: () => Response;
}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url === '/api/v1/csrf') return json({ token: 'token-1' });
    if (url === '/api/v1/auth/me') {
      return handlers.me === undefined ? json({}, 401) : json(handlers.me);
    }
    if (url === '/api/v1/orders/LC-000001/cancel' && method === 'POST') {
      return handlers.cancel
        ? handlers.cancel()
        : json({ ...ORDER, status: 'CANCELLED', paymentStatus: 'FAILED' });
    }
    if (url === '/api/v1/orders/LC-000001') return handlers.order ? handlers.order() : json(ORDER);
    throw new Error('pedido inesperado: ' + method + ' ' + url);
  });
}

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/conta/encomendas/LC-000001']}>
      <Routes>
        <Route path="/conta/encomendas/:number" element={<OrderDetailPage />} />
        <Route path="/conta/encomendas" element={<p>Lista de encomendas</p>} />
        <Route path="/entrar" element={<p>Ecrã de login</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('OrderDetailPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetSession();
  });

  it('mostra o snapshot da encomenda, estados e totais do servidor', async () => {
    mockApi({ me: USER });
    await refreshSession();
    renderDetail();

    expect(await screen.findByText('LC-000001')).toBeInTheDocument();
    // Estados traduzidos (encomenda + pagamento).
    expect(screen.getAllByText('Recebida').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pagamento: Por confirmar').length).toBeGreaterThan(0);
    // Snapshot de artigos e valores.
    expect(screen.getByText('Bolo no Pote Premium')).toBeInTheDocument();
    expect(screen.getByText('×2')).toBeInTheDocument();
    expect(screen.getAllByText(/7\s?000,00\s*Kz/).length).toBeGreaterThan(0);
    // Dados próprios registados.
    expect(screen.getByText('Ana Compradora')).toBeInTheDocument();
    expect(screen.getByText('Sem velas, por favor.')).toBeInTheDocument();
    expect(screen.getByText(/Registada a/)).toBeInTheDocument();
  });

  it('mostra o desconto de fidelização registado pelo servidor na linha de totais', async () => {
    mockApi({
      me: USER,
      order: () =>
        json({
          ...ORDER,
          discountAmount: '1000.00',
          discountLabel: 'Pontos de fidelização',
          pointsSpent: 1000,
          total: '6000.00',
        }),
    });
    await refreshSession();
    renderDetail();

    expect(await screen.findByText('LC-000001')).toBeInTheDocument();
    // Linha de desconto com o rótulo e os pontos que o servidor gravou.
    expect(screen.getByText('Pontos de fidelização (1000 pontos usados)')).toBeInTheDocument();
    expect(screen.getByText(/1\s?000,00\s*Kz/)).toBeInTheDocument();
    // Total final já com o desconto aplicado.
    expect(screen.getByText(/6\s?000,00\s*Kz/)).toBeInTheDocument();
  });

  it('cancela a encomenda com confirmação e reflecte o novo estado', async () => {
    const user = userEvent.setup();
    const spy = mockApi({ me: USER });
    await refreshSession();
    renderDetail();

    await screen.findByText('Bolo no Pote Premium');
    await user.click(screen.getByRole('button', { name: 'Cancelar encomenda' }));

    // Confirmação explícita antes de enviar.
    const dialog = await screen.findByRole('alertdialog', { name: /confirmar cancelamento/i });
    expect(dialog).toHaveTextContent('LC-000001');

    await user.click(screen.getByRole('button', { name: 'Sim, cancelar' }));

    await waitFor(() => {
      expect(screen.getAllByText('Cancelada').length).toBeGreaterThan(0);
    });
    const cancelCall = spy.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/v1/orders/LC-000001/cancel' &&
        (init?.method ?? 'GET').toUpperCase() === 'POST',
    );
    expect(cancelCall).toBeDefined();
    // O botão desaparece: já não há nada para cancelar.
    expect(screen.queryByRole('button', { name: 'Cancelar encomenda' })).not.toBeInTheDocument();
  });

  it('quando o servidor rejeita o cancelamento (409) mostra o motivo e mantém o estado', async () => {
    const user = userEvent.setup();
    mockApi({
      me: USER,
      cancel: () =>
        json(
          {
            status: 409,
            code: 'ORDER_NOT_CANCELLABLE',
            message: 'Só é possível cancelar antes de a loja confirmar a encomenda. Contacte a loja.',
            path: '/api/v1/orders/LC-000001/cancel',
            fieldErrors: {},
          },
          409,
        ),
    });
    await refreshSession();
    renderDetail();

    await screen.findByText('Bolo no Pote Premium');
    await user.click(screen.getByRole('button', { name: 'Cancelar encomenda' }));
    await user.click(screen.getByRole('button', { name: 'Sim, cancelar' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Só é possível cancelar antes de a loja confirmar');
    // Continua RECEIVED — o servidor não deixou cancelar.
    expect(screen.getAllByText('Recebida').length).toBeGreaterThan(0);
  });

  it('numa encomenda já confirmada não oferece cancelamento', async () => {
    mockApi({
      me: USER,
      order: () => json({ ...ORDER, status: 'CONFIRMED', paymentStatus: 'PAID' }),
    });
    await refreshSession();
    renderDetail();

    expect(await screen.findByText('Confirmada')).toBeInTheDocument();
    expect(screen.getByText('Pagamento: Pago')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar encomenda' })).not.toBeInTheDocument();
    expect(screen.getByText(/fale connosco/i)).toBeInTheDocument();
  });

  it('encomenda inexistente ou de outro cliente mostra 404 honesto', async () => {
    mockApi({
      me: USER,
      order: () =>
        json({ status: 404, code: 'ORDER_NOT_FOUND', message: 'Encomenda não encontrada.', path: '/api/v1/orders/LC-000001' }, 404),
    });
    await refreshSession();
    renderDetail();

    expect(await screen.findByText('Encomenda não encontrada')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /voltar às minhas encomendas/i })).toHaveAttribute(
      'href',
      '/conta/encomendas',
    );
  });

  it('sem sessão pede login em vez de mostrar dados', async () => {
    mockApi({}); // /me → 401
    await refreshSession();
    renderDetail();

    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect(screen.queryByText('Bolo no Pote Premium')).not.toBeInTheDocument();
  });
});
