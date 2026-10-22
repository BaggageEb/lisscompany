import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ProductDetailPage } from './ProductDetailPage';
import { ApiError } from '../lib/api';
import { CART_STORAGE_KEY } from '../lib/cart';

function makeProduct(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'p1',
    slug: 'bolo-no-pote-classico',
    name: 'Bolo no Pote Clássico',
    description: 'A especialidade da casa.',
    basePrice: '2500.00',
    currency: 'AOA',
    imageUrl: null,
    categorySlug: 'bolos-no-pote',
    categoryName: 'Bolos no Pote',
    available: true,
    ...overrides,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderDetail(slug = 'bolo-no-pote-classico') {
  window.history.pushState({}, '', `/loja/${slug}`);
  return render(
    <BrowserRouter>
      <Routes>
        <Route path="/loja/:slug" element={<ProductDetailPage />} />
        <Route path="/loja" element={<div>PAGINA_LOJA</div>} />
      </Routes>
    </BrowserRouter>,
  );
}

describe('ProductDetailPage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('carrega o produto pelo slug e adiciona ao carrinho', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(makeProduct()));
    const user = userEvent.setup();
    renderDetail();

    expect(await screen.findByRole('heading', { name: /Bolo no Pote Clássico/i })).toBeInTheDocument();
    expect(screen.getByText(/2\s?500,00\s*Kz/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Adicionar ao carrinho/i }));

    const cart = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) ?? '{}');
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]).toMatchObject({
      kind: 'PRODUCT',
      productId: 'p1',
      unitPrice: '2500.00',
      quantity: 1,
    });
    expect(await screen.findByText(/Carrinho: 1 artigo/i)).toBeInTheDocument();
  });

  it('acumula quantidade quando o mesmo produto é adicionado duas vezes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(makeProduct()));
    const user = userEvent.setup();
    renderDetail();

    const button = await screen.findByRole('button', { name: /Adicionar ao carrinho/i });
    await user.click(button);
    await user.click(screen.getByRole('button', { name: /Adicionado/i }));

    const cart = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) ?? '{}');
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0].quantity).toBe(2);
  });

  it('desactiva a adição quando o produto está esgotado', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(makeProduct({ available: false })));
    renderDetail();

    expect(await screen.findByRole('heading', { name: /Bolo no Pote Clássico/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Adicionar ao carrinho/i })).toBeDisabled();
    expect(screen.getByText(/Esgotado/i)).toBeInTheDocument();
  });

  it('mostra «produto não encontrado» para slug inexistente', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new ApiError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.', '/products/nao-existe'),
    );
    renderDetail('nao-existe');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Produto não encontrado/i);
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Voltar à loja/i })).toHaveAttribute('href', '/loja');
  });
});
