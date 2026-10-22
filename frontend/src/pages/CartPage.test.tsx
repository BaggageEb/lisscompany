import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CartPage } from './CartPage';
import { addCartLine, type ProductCartLine } from '../lib/cart';
import type { CartQuote } from '../lib/api';

function productLine(overrides: Partial<ProductCartLine> = {}): ProductCartLine {
  return {
    kind: 'PRODUCT',
    productId: 'p1',
    slug: 'bolo-no-pote-classico',
    name: 'Bolo no Pote Clássico',
    unitPrice: '2500.00',
    quantity: 1,
    imageUrl: null,
    ...overrides,
  };
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function quoteBody(overrides: Partial<CartQuote> = {}): CartQuote {
  return {
    valid: true,
    total: '2500.00',
    currency: 'AOA',
    lines: [
      {
        kind: 'PRODUCT',
        name: 'Bolo no Pote Clássico',
        unitPrice: '2500.00',
        quantity: 1,
        lineTotal: '2500.00',
        valid: true,
        issues: [],
      },
    ],
    issues: [],
    ...overrides,
  };
}

/** Corpo JSON enviado ao backend na chamada indicada (por omissão, a última). */
function requestJson(call = -1): { productLines: unknown[]; cakeLines: unknown[] } {
  const calls = vi.mocked(globalThis.fetch).mock.calls;
  const [, init] = calls[call === -1 ? calls.length - 1 : call];
  return JSON.parse(String(init?.body)) as { productLines: unknown[]; cakeLines: unknown[] };
}

function renderCart() {
  return render(
    <MemoryRouter>
      <CartPage />
    </MemoryRouter>,
  );
}

describe('CartPage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('mostra as linhas e só envia identificadores e quantidades ao servidor', async () => {
    addCartLine(productLine());
    addCartLine(
      productLine({
        productId: 'p2',
        slug: 'caixa-degustacao',
        name: 'Caixa de Degustação',
        unitPrice: '12000.00',
        quantity: 2,
      }),
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({
        valid: true,
        total: '26500.00',
        currency: 'AOA',
        lines: [
          {
            kind: 'PRODUCT',
            name: 'Bolo no Pote Clássico',
            unitPrice: '2500.00',
            quantity: 1,
            lineTotal: '2500.00',
            valid: true,
            issues: [],
          },
          {
            kind: 'PRODUCT',
            name: 'Caixa de Degustação',
            unitPrice: '12000.00',
            quantity: 2,
            lineTotal: '24000.00',
            valid: true,
            issues: [],
          },
        ],
        issues: [],
      }),
    );
    renderCart();

    expect(await screen.findByText('Bolo no Pote Clássico')).toBeInTheDocument();
    expect(screen.getByText('Caixa de Degustação')).toBeInTheDocument();

    // O total só fica confirmado depois da resposta do servidor.
    expect(await screen.findByRole('button', { name: 'Finalizar compra' })).toBeEnabled();
    expect(screen.getAllByText(/26\s?500,00\s*Kz/).length).toBeGreaterThan(0);

    // O contrato não leva preço nenhum do navegador.
    expect(requestJson().productLines).toEqual([
      { productId: 'p1', quantity: 1 },
      { productId: 'p2', quantity: 2 },
    ]);
    expect(requestJson().cakeLines).toEqual([]);
  });

  it('sinaliza quando o servidor confirma um preço diferente do estimado', async () => {
    addCartLine(productLine());
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json(
        quoteBody({
          total: '3000.00',
          lines: [
            {
              kind: 'PRODUCT',
              name: 'Bolo no Pote Clássico',
              unitPrice: '3000.00',
              quantity: 1,
              lineTotal: '3000.00',
              valid: true,
              issues: [],
            },
          ],
        }),
      ),
    );
    renderCart();

    expect(await screen.findByText(/preços mudaram/i)).toBeInTheDocument();
    expect(screen.getAllByText(/3\s?000,00\s*Kz/).length).toBeGreaterThan(0);
    // O preço estimado continua visível, mas marcado como superado.
    const struckPrice = screen.getAllByText(/2\s?500,00\s*Kz/).find((element) => element.tagName === 'S');
    expect(struckPrice).toBeDefined();
    expect(screen.getByRole('button', { name: 'Finalizar compra' })).toBeEnabled();
  });

  it('bloqueia a finalização quando o servidor não valida uma linha', async () => {
    addCartLine(productLine());
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json(
        quoteBody({
          valid: false,
          total: '0.00',
          lines: [
            {
              kind: 'PRODUCT',
              name: 'Bolo no Pote Clássico',
              unitPrice: '0.00',
              quantity: 1,
              lineTotal: '0.00',
              valid: false,
              issues: ['Produto: já não está disponível.'],
            },
          ],
          issues: [],
        }),
      ),
    );
    renderCart();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Bolo no Pote Clássico: Produto: já não está disponível.');
    expect(screen.getByRole('button', { name: 'Corrija os problemas acima' })).toBeDisabled();
  });

  it('sem artigos mostra o estado vazio e não contacta o servidor', async () => {
    vi.spyOn(globalThis, 'fetch');
    renderCart();

    expect(await screen.findByText('O seu carrinho está vazio.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ir para a loja' })).toBeInTheDocument();
    await waitFor(() => expect(globalThis.fetch).not.toHaveBeenCalled());
  });

  it('aumentar quantidade reenvia a nova quantidade para o servidor', async () => {
    addCartLine(productLine());
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(quoteBody()));
    const user = userEvent.setup();
    renderCart();

    await screen.findByRole('button', { name: 'Finalizar compra' });
    await user.click(screen.getByRole('button', { name: 'Aumentar quantidade de Bolo no Pote Clássico' }));

    expect(screen.getByRole('group', { name: 'Quantidade de Bolo no Pote Clássico' })).toHaveTextContent('2');
    await waitFor(() => {
      expect(requestJson().productLines).toEqual([{ productId: 'p1', quantity: 2 }]);
    });
  });

  it('remover um artigo volta ao estado vazio', async () => {
    addCartLine(productLine());
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(quoteBody()));
    const user = userEvent.setup();
    renderCart();

    await screen.findByText('Bolo no Pote Clássico');
    await user.click(screen.getByRole('button', { name: /remover bolo no pote clássico do carrinho/i }));

    expect(await screen.findByText('O seu carrinho está vazio.')).toBeInTheDocument();
  });

  it('não deixa diminuir a quantidade abaixo de um', async () => {
    addCartLine(productLine());
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(quoteBody()));
    renderCart();

    await screen.findByText('Bolo no Pote Clássico');
    expect(screen.getByRole('button', { name: 'Diminuir quantidade de Bolo no Pote Clássico' })).toBeDisabled();
  });
});
