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

const QUOTE = {
  valid: true,
  total: '3500.00',
  currency: 'AOA',
  lines: [{ kind: 'PRODUCT', name: 'Bolo', unitPrice: '3500.00', quantity: 1, lineTotal: '3500.00', valid: true, issues: [] }],
  issues: [],
};

const STORE = {
  settings: {
    contacts: {},
    pickup: { address: 'Loja Centro', hours: '9h–17h', instructions: '', askSlot: 'false' },
    pickupEnabled: true,
    deliveryEnabled: true,
    deliveryNotes: '',
    paymentMethods: [
      { method: 'ON_DELIVERY', enabled: true, configured: true },
      { method: 'IBAN_TRANSFER', enabled: false, configured: false },
      { method: 'MULTICAIXA_EXPRESS', enabled: true, configured: true },
    ],
    policies: { terms: 'Texto dos termos' },
    termsRequired: true,
  },
  deliveryZones: [{ id: 'z1', name: 'Centro', fee: '1500.00', freeOver: null, leadTime: '1 dia', schedule: null, active: true, displayOrder: 0 }],
};

const line: ProductCartLine = {
  kind: 'PRODUCT',
  productId: 'p1',
  slug: 'bolo',
  name: 'Bolo',
  unitPrice: '3500.00',
  quantity: 1,
  imageUrl: null,
};

describe('Checkout com zonas de entrega, métodos e termos configurados pela loja', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('exige zona e termos, esconde métodos desactivados e envia a zona ao servidor', async () => {
    const posted: Record<string, unknown>[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url === '/api/v1/csrf') return json({ token: 't' });
      if (url === '/api/v1/auth/me') return json({ id: 'u', email: 'a@b.pt', displayName: 'Ana', phone: '912345678' });
      if (url === '/api/v1/public/cart/quote') return json(QUOTE);
      if (url === '/api/v1/public/store') return json(STORE);
      if (url === '/api/v1/loyalty') return json({ configured: false, active: false, pointsBalance: 0, lifetimePoints: 0, rewards: [], welcome: null });
      if (url === '/api/v1/orders' && method === 'POST') {
        posted.push(JSON.parse(String(init?.body)));
        throw new Error('parar aqui');
      }
      throw new Error('pedido inesperado: ' + method + ' ' + url);
    });
    await refreshSession();
    addCartLine(line);
    expect(getCart().lines).toHaveLength(1);

    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/checkout']}>
        <Routes>
          <Route path="/checkout" element={<CheckoutPage />} />
        </Routes>
      </MemoryRouter>,
    );

    // Método desactivado pela loja não aparece.
    await screen.findByRole('radio', { name: /multicaixa express/i });
    expect(screen.queryByRole('radio', { name: /transferência iban/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /multicaixa express/i }));
    await user.click(screen.getByRole('radio', { name: /entrega ao domicílio/i }));
    const submit = screen.getByRole('button', { name: 'Registar encomenda' });
    expect(submit).toBeDisabled(); // falta zona e termos

    await user.selectOptions(await screen.findByLabelText('Zona de entrega'), 'z1');
    expect(screen.getByText(/Entrega \(Centro\)/)).toBeInTheDocument();
    expect(submit).toBeDisabled(); // faltam os termos
    await user.click(screen.getByRole('checkbox', { name: /aceito os termos/i }));
    await user.type(screen.getByLabelText('Morada'), 'Rua 1');
    await user.type(screen.getByLabelText('Cidade'), 'Luanda');
    expect(submit).toBeEnabled();

    await user.click(submit);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ fulfillment: 'DELIVERY', deliveryZoneId: 'z1', termsAccepted: true, paymentMethod: 'MULTICAIXA_EXPRESS' });
  });
});
