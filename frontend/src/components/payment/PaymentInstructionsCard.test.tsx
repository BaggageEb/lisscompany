import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PaymentInstructionsCard } from './PaymentInstructionsCard';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const VIEW = {
  status: 'PENDING',
  amount: '9500.00',
  instructions: { method: 'IBAN_TRANSFER', holder: 'Titular Teste', iban: 'AO06 0000 0000', number: null, note: null },
  proofReference: null,
};

describe('PaymentInstructionsCard', () => {
  afterEach(() => vi.restoreAllMocks());

  it('mostra os dados configurados pela loja e envia a referência (sem marcar como pago)', async () => {
    const proofs: unknown[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url === '/api/v1/csrf') return json({ token: 't' });
      if (url === '/api/v1/orders/LC-1/payment') return json(VIEW);
      if (url === '/api/v1/orders/LC-1/payment/proof' && method === 'POST') {
        proofs.push(JSON.parse(String(init?.body)));
        return json({ status: 'UNDER_REVIEW' });
      }
      throw new Error('pedido inesperado: ' + method + ' ' + url);
    });
    const user = userEvent.setup();
    render(<PaymentInstructionsCard orderNumber="LC-1" method="IBAN_TRANSFER" paymentStatus="PENDING" />);
    expect(await screen.findByText('AO06 0000 0000')).toBeInTheDocument();
    expect(screen.getByText('Titular Teste')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/referência da transferência/i), 'REF-998877');
    await user.click(screen.getByRole('button', { name: 'Enviar referência' }));
    await waitFor(() => expect(proofs).toEqual([{ reference: 'REF-998877' }]));
    expect(await screen.findByText(/Referência enviada/)).toBeInTheDocument();
  });

  it('não aparece quando o pagamento já foi confirmado', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(VIEW));
    const { container } = render(<PaymentInstructionsCard orderNumber="LC-1" method="IBAN_TRANSFER" paymentStatus="PAID" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
