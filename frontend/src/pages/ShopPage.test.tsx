import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ShopPage } from './ShopPage';
import { ApiError } from '../lib/api';

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

const PRODUCTS = [
  makeProduct(),
  makeProduct({
    id: 'p2',
    slug: 'caixa-degustacao',
    name: 'Caixa de Degustação',
    basePrice: '12000.00',
    categorySlug: 'caixas-presente',
    categoryName: 'Caixas & Presentes',
  }),
];

function renderShop() {
  return render(
    <MemoryRouter>
      <ShopPage />
    </MemoryRouter>,
  );
}

describe('ShopPage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('mostra o catálogo vindo da API com preços e disponibilidade', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(PRODUCTS));
    renderShop();

    expect(await screen.findByText('Bolo no Pote Clássico')).toBeInTheDocument();
    expect(screen.getByText('Caixa de Degustação')).toBeInTheDocument();
    expect(screen.getAllByText(/2\s?500,00\s*Kz/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Disponível/).length).toBe(2);
    // Cada produto leva à sua ficha.
    expect(screen.getAllByRole('link', { name: /Ver detalhe/i })[0]).toHaveAttribute(
      'href',
      '/loja/bolo-no-pote-classico',
    );
  });

  it('filtra por categoria e volta a mostrar todos', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(PRODUCTS));
    const user = userEvent.setup();
    renderShop();

    await screen.findByText('Bolo no Pote Clássico');
    await user.click(screen.getByRole('button', { name: /Caixas & Presentes/i }));

    await waitFor(() => {
      expect(screen.queryByText('Bolo no Pote Clássico')).not.toBeInTheDocument();
      expect(screen.getByText('Caixa de Degustação')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Todos/i }));
    await waitFor(() => {
      expect(screen.getByText('Bolo no Pote Clássico')).toBeInTheDocument();
    });
  });

  it('mostra estado de erro legível e permite recarregar', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Sem ligação ao servidor.', '/products'))
      .mockResolvedValue(json(PRODUCTS));
    const user = userEvent.setup();
    renderShop();

    expect(await screen.findByText(/sem ligação ao servidor/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /tentar novamente/i }));
    expect(await screen.findByText('Bolo no Pote Clássico')).toBeInTheDocument();
  });

  it('mostra mensagem de vazio quando não há produtos na categoria', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json([]));
    renderShop();

    expect(await screen.findByText(/Nenhum produto disponível/i)).toBeInTheDocument();
  });
});
