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
  deliveryZones: [
    { id: 'z1', name: 'Centro', fee: '1500.00', freeOver: null, leadTime: '1 dia', schedule: null, active: true, displayOrder: 0, freeDelivery: false, priced: true },
  ],
  delivery: { mode: 'ZONES', flatFee: null, flatFreeOver: null, available: true, issue: null },
};

/** Orçamento do servidor: com entrega, calcula o preço pela zona (ou diz porque não pode). */
function quoteFor(body: { fulfillment?: string; deliveryZoneId?: string }) {
  if (body.fulfillment !== 'DELIVERY') return { ...QUOTE, grandTotal: '3500.00' };
  if (body.deliveryZoneId === 'z1') {
    return {
      ...QUOTE,
      grandTotal: '5000.00',
      delivery: { available: true, fee: '1500.00', free: false, zoneId: 'z1', zoneName: 'Centro', issue: null, field: null },
    };
  }
  return {
    ...QUOTE,
    grandTotal: '3500.00',
    delivery: { available: false, fee: null, free: false, zoneId: null, zoneName: null, issue: 'Escolha a zona de entrega.', field: 'deliveryZoneId' },
  };
}

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
      if (url === '/api/v1/public/cart/quote') return json(quoteFor(JSON.parse(String(init?.body))));
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

    // Só existe uma zona com preço: o checkout identifica-a sozinho (o cliente pode mudar).
    await waitFor(() => expect(screen.getByLabelText('Zona de entrega')).toHaveValue('z1'));
    // O custo calculado pelo servidor aparece antes de confirmar e entra no total.
    await waitFor(() => expect(screen.getByTestId('delivery-row')).toHaveTextContent(/Entrega ao domicílio \(Centro\).*1\D?500/));
    await waitFor(() => expect(screen.getByText(/Total confirmado pelo servidor/).closest('div')).toHaveTextContent(/5\D?000/));
    expect(submit).toBeDisabled(); // faltam os termos
    await user.click(screen.getByRole('checkbox', { name: /aceito os termos/i }));
    await user.type(screen.getByLabelText('Morada'), 'Rua 1');
    await user.type(screen.getByLabelText('Cidade'), 'Luanda');
    expect(submit).toBeEnabled();

    await user.click(submit);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ fulfillment: 'DELIVERY', deliveryZoneId: 'z1', termsAccepted: true, paymentMethod: 'MULTICAIXA_EXPRESS' });
  });

  it('com preço fixo não pede zona e mostra o custo; sem configuração bloqueia a entrega', async () => {
    let mode: 'flat' | 'none' = 'flat';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === '/api/v1/csrf') return json({ token: 't' });
      if (url === '/api/v1/auth/me') return json({ id: 'u', email: 'a@b.pt', displayName: 'Ana', phone: '912345678' });
      if (url === '/api/v1/public/cart/quote') {
        const body = JSON.parse(String(init?.body));
        if (body.fulfillment !== 'DELIVERY') return json({ ...QUOTE, grandTotal: '3500.00' });
        return json(
          mode === 'flat'
            ? { ...QUOTE, grandTotal: '5500.00', delivery: { available: true, fee: '2000.00', free: false, zoneId: null, zoneName: null, issue: null, field: null } }
            : { ...QUOTE, grandTotal: '3500.00', delivery: { available: false, fee: null, free: false, zoneId: null, zoneName: null, issue: 'A entrega ao domicílio ainda não está configurada pela loja.', field: 'fulfillment' } },
        );
      }
      if (url === '/api/v1/public/store') {
        return json({
          ...STORE,
          settings: { ...STORE.settings, termsRequired: false },
          deliveryZones: [],
          delivery:
            mode === 'flat'
              ? { mode: 'FLAT', flatFee: '2000.00', flatFreeOver: null, available: true, issue: null }
              : { mode: null, flatFee: null, flatFreeOver: null, available: false, issue: 'A entrega ao domicílio ainda não está configurada pela loja.' },
        });
      }
      if (url === '/api/v1/loyalty') return json({ configured: false, active: false, pointsBalance: 0, lifetimePoints: 0, rewards: [], welcome: null });
      throw new Error('pedido inesperado: ' + url);
    });
    await refreshSession();
    addCartLine(line);
    const user = userEvent.setup();
    const { unmount } = render(
      <MemoryRouter initialEntries={['/checkout']}>
        <Routes>
          <Route path="/checkout" element={<CheckoutPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('radio', { name: /multicaixa express/i }));
    await user.click(screen.getByRole('radio', { name: /entrega ao domicílio/i }));
    expect(screen.queryByLabelText('Zona de entrega')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('delivery-row')).toHaveTextContent(/2\D?000/));
    await waitFor(() => expect(screen.getByText(/Total confirmado pelo servidor/).closest('div')).toHaveTextContent(/5\D?500/));
    unmount();

    // Entrega por configurar: nunca «0 Kz» — fica por definir e o botão bloqueado.
    mode = 'none';
    localStorage.clear();
    addCartLine(line);
    render(
      <MemoryRouter initialEntries={['/checkout']}>
        <Routes>
          <Route path="/checkout" element={<CheckoutPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('radio', { name: /multicaixa express/i }));
    await user.click(screen.getByRole('radio', { name: /entrega ao domicílio/i }));
    expect(await screen.findByTestId('delivery-issue')).toHaveTextContent(/não está configurada/);
    expect(screen.getByTestId('delivery-row')).toHaveTextContent('por definir');
    expect(screen.getByRole('button', { name: 'Registar encomenda' })).toBeDisabled();
  });
});
