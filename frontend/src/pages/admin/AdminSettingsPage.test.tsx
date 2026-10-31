import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AdminSettingsPage } from './AdminSettingsPage';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('AdminSettingsPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('guarda os contactos e só envia as chaves do separador', async () => {
    const puts: unknown[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url === '/api/v1/csrf') return json({ token: 't' });
      if (url === '/api/v1/admin/settings' && method === 'GET') return json({ 'contact.phone': '', 'payment.iban': '' });
      if (url === '/api/v1/admin/settings' && method === 'PUT') {
        puts.push(JSON.parse(String(init?.body)));
        return json({ 'contact.phone': '923000000' });
      }
      if (url === '/api/v1/admin/delivery-zones') return json([]);
      throw new Error('pedido inesperado: ' + method + ' ' + url);
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AdminSettingsPage />
      </MemoryRouter>,
    );
    await user.type(await screen.findByLabelText('Telefone'), '923000000');
    await user.click(screen.getByRole('button', { name: 'Guardar alterações' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({ 'contact.phone': '923000000' });
    expect(Object.keys(puts[0] as object)).not.toContain('payment.iban');
    expect(await screen.findByText('Definições guardadas.')).toBeInTheDocument();
  });

  it('o separador Pagamentos explica que os dados nunca são públicos', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/v1/admin/settings') return json({});
      return json([]);
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AdminSettingsPage />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('tab', { name: 'Pagamentos' }));
    expect(screen.getByLabelText('IBAN / NIB')).toBeInTheDocument();
    expect(screen.getByText(/Nunca aparecem na loja pública/)).toBeInTheDocument();
  });
});
