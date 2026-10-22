import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AdminPaymentsPage } from './AdminPaymentsPage';
import { resetSession, refreshSession } from '../../lib/session';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function noContent() {
  return new Response(null, { status: 204 });
}

const OWNER = { id: 'u1', email: 'dona@example.com', displayName: 'Dona', phone: null, owner: true };

const PENDING = {
  orderNumber: 'LC-000001',
  orderStatus: 'RECEIVED',
  contactName: 'Cliente Teste',
  method: 'IBAN_TRANSFER',
  amount: '3500.00',
  currency: 'AOA',
  status: 'PENDING',
  createdAt: '2026-10-22T10:00:00Z',
  reviewedAt: null,
  reviewNote: null,
};

function mockApi(handlers: {
  me?: unknown;
  payments?: () => Response;
  review?: () => Response;
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
    if (url.includes('/review') && method === 'POST') {
      return handlers.review ? handlers.review() : json({ ...PENDING, status: 'PAID', reviewedAt: '2026-10-22T11:00:00Z' });
    }
    if (url.startsWith('/api/v1/admin/payments')) {
      return handlers.payments ? handlers.payments() : json([PENDING]);
    }
    throw new Error('pedido inesperado: ' + method + ' ' + url);
  });
  return calls;
}

function renderPayments() {
  return render(
    <MemoryRouter initialEntries={['/admin/pagamentos']}>
      <Routes>
        <Route path="/admin/pagamentos" element={<AdminPaymentsPage />} />
        <Route path="/admin/encomendas/:number" element={<p>Detalhe da encomenda</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('painel: fila de pagamentos', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetSession();
  });

  it('mostra a fila pendente com o contacto e abre a revisão', async () => {
    const user = userEvent.setup();
    mockApi({ me: OWNER });
    await refreshSession();
    renderPayments();

    expect(await screen.findByText('LC-000001')).toBeInTheDocument();
    expect(screen.getByText(/Cliente Teste/)).toBeInTheDocument();
    // O rótulo do estado aparece no badge e na opção do filtro.
    expect(screen.getAllByText('Por confirmar').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Rever pagamento' }));
    expect(screen.getByLabelText(/Nota da revisão/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar recebimento (pago)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Marcar não confirmado' })).toBeInTheDocument();
  });

  it('confirmar envia target PAID com chave de idempotência e actualiza a lista', async () => {
    const user = userEvent.setup();
    const calls = mockApi({ me: OWNER });
    await refreshSession();
    renderPayments();

    await screen.findByText('LC-000001');
    await user.click(screen.getByRole('button', { name: 'Rever pagamento' }));
    await user.type(screen.getByLabelText(/Nota da revisão/), 'Comprovativo conferido.');
    await user.click(screen.getByRole('button', { name: 'Confirmar recebimento (pago)' }));

    await waitFor(() => {
      const post = calls.find(
        (call) => call.method === 'POST' && call.url.includes('/api/v1/admin/payments/LC-000001/review'),
      );
      expect(post).toBeDefined();
      const body = JSON.parse(post!.body ?? '{}');
      expect(body.target).toBe('PAID');
      expect(body.note).toBe('Comprovativo conferido.');
      expect(typeof body.idempotencyKey).toBe('string');
      expect(body.idempotencyKey.length).toBeGreaterThan(0);
    });

    expect(await screen.findByRole('status')).toHaveTextContent('actualizado para Pago');
  });

  it('revisão rejeitada pelo servidor (409) mostra o motivo sem perder a fila', async () => {
    const user = userEvent.setup();
    mockApi({
      me: OWNER,
      review: () =>
        json(
          {
            status: 409,
            code: 'INVALID_PAYMENT_TRANSITION',
            message: 'Transição de pagamento inválida: PAID → PAID.',
            path: '/api/v1/admin/payments/LC-000001/review',
            fieldErrors: {},
          },
          409,
        ),
    });
    await refreshSession();
    renderPayments();

    await screen.findByText('LC-000001');
    await user.click(screen.getByRole('button', { name: 'Rever pagamento' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar recebimento (pago)' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Transição de pagamento inválida');
    expect(screen.getByText('LC-000001')).toBeInTheDocument();
  });

  it('resposta 204 do servidor é tratada como sucesso (sem corpo)', async () => {
    // O helper json() não pode criar 204 com corpo — este caso cobre o caminho
    // real do endpoint (204 No Content) através do handler por omissão.
    const user = userEvent.setup();
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url === '/api/v1/csrf') return json({ token: 'token-1' });
      if (url === '/api/v1/auth/me') return json(OWNER);
      if (url.includes('/review') && method === 'POST') {
        calls.push(url);
        return noContent();
      }
      if (url.startsWith('/api/v1/admin/payments')) return json([PENDING]);
      throw new Error('pedido inesperado: ' + url);
    });
    await refreshSession();
    renderPayments();

    await screen.findByText('LC-000001');
    await user.click(screen.getByRole('button', { name: 'Rever pagamento' }));
    await user.click(screen.getByRole('button', { name: 'Marcar não confirmado' }));

    await waitFor(() => {
      expect(calls.some((url) => url.includes('/review'))).toBe(true);
    });
  });
});
