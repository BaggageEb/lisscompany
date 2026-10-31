import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AdminProductsPage } from './AdminProductsPage';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const CATEGORY = { id: 'c1', slug: 'aniversario', name: 'Aniversário', description: null, displayOrder: 0, products: 1 };
const PRODUCT = {
  id: 'p1',
  slug: 'bolo-morango',
  name: 'Bolo de Morango',
  description: 'Fresco',
  basePrice: '9500.00',
  status: 'ACTIVE',
  cakeStudioBase: false,
  categoryId: 'c1',
  categoryName: 'Aniversário',
  imageUrl: '/api/v1/public/media/aaa.png',
  gallery: [],
  stockQty: 4,
  updatedAt: '2026-10-20T10:00:00Z',
};

function mockApi(onPost?: (body: unknown) => void) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url === '/api/v1/csrf') return json({ token: 't' });
    if (url === '/api/v1/admin/catalog/products' && method === 'GET') return json([PRODUCT]);
    if (url === '/api/v1/admin/catalog/categories') return json([CATEGORY]);
    if (url === '/api/v1/admin/catalog/products' && method === 'POST') {
      const body = JSON.parse(String(init?.body));
      onPost?.(body);
      return json({ ...PRODUCT, id: 'p2', name: body.name, basePrice: body.basePrice, stockQty: null }, 201);
    }
    throw new Error('pedido inesperado: ' + method + ' ' + url);
  });
}

describe('AdminProductsPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lista os produtos com fotografia e estado', async () => {
    mockApi();
    render(
      <MemoryRouter>
        <AdminProductsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Bolo de Morango')).toBeInTheDocument();
    expect(screen.getByAltText('Fotografia de Bolo de Morango')).toBeInTheDocument();
    expect(screen.getByText('À venda')).toBeInTheDocument();
  });

  it('a proprietária cria um bolo novo com nome, preço e categoria', async () => {
    const posted = vi.fn();
    mockApi(posted);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AdminProductsPage />
      </MemoryRouter>,
    );
    await screen.findByText('Bolo de Morango');
    await user.click(screen.getByRole('button', { name: '+ Novo produto' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(dialog.querySelector('input[type="text"], input:not([type])') as HTMLInputElement, 'Bolo de Chocolate');
    await user.type(screen.getByLabelText(/Preço \(Kz\)/), '12000');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(posted).toHaveBeenCalled());
    expect(posted.mock.calls[0][0]).toMatchObject({ name: 'Bolo de Chocolate', basePrice: '12000', categoryId: 'c1' });
    expect(await screen.findByText(/«Bolo de Chocolate» guardado/)).toBeInTheDocument();
  });
});
