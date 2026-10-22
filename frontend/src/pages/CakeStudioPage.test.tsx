import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CakeStudioPage } from './CakeStudioPage';
import { ApiError } from '../lib/api';
import { makeOptions } from '../lib/cakeStudio/fixtures';
import { CART_STORAGE_KEY } from '../lib/cart';

const optionsPayload = makeOptions();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Mock completo da API: opções + orçamento (como o servidor real responderia). */
function mockApi(quoteBody: unknown = null): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    if (url.includes('/cake-studio/options')) {
      return json(optionsPayload);
    }
    if (url.includes('/cake-studio/quote')) {
      return json(quoteBody ?? { valid: true, total: '3500.00', currency: 'AOA', lines: [], issues: [] });
    }
    return json({ code: 'NOT_FOUND' }, 404);
  });
}

function renderStudio() {
  return render(
    <MemoryRouter initialEntries={['/cake-studio']}>
      <Routes>
        <Route path="/cake-studio" element={<CakeStudioPage />} />
        <Route path="/carrinho" element={<div>PAGINA_CARRINHO</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function clickContinue(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /continuar/i }));
}

/** Escolhe uma opção pelo valor do input escondido — imune aos rótulos SVG do copo. */
async function pickOption(user: ReturnType<typeof userEvent.setup>, value: string) {
  await user.click(await screen.findByDisplayValue(value));
}

// A página atrasa deliberadamente o pedido de orçamento (debounce de ~350 ms)
// para não martellar o servidor a cada mudança; em CI o jsdom pode estar lento,
// por isso as esperas do passo 6 usam um orçamento de tempo generoso.
const REVIEW_TIMEOUT = { timeout: 3000 };

describe('CakeStudioPage — percurso completo', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('constrói o bolo nos 6 passos e adiciona ao carrinho com preço do servidor', async () => {
    mockApi();
    const user = userEvent.setup();
    renderStudio();

    // Passo 1 — massa (bloqueado até escolher)
    const continuar = await screen.findByRole('button', { name: /continuar/i });
    expect(continuar).toBeDisabled();
    await pickOption(user, 'base-vanilla');
    expect(continuar).toBeEnabled();
    await clickContinue(user);

    // Passo 2 — primeiro recheio
    await pickOption(user, 'fill-strawberry');
    await clickContinue(user);

    // Passo 3 — segunda camada com a MESMA massa, sem escolha possível
    expect(await screen.findByRole('heading', { name: /segunda camada de massa/i })).toBeInTheDocument();
    // O painel repete a massa escolhida; nenhuma 2ª variedade é oferecida.
    expect(screen.getByText(/entra agora no copo com a/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    await clickContinue(user);

    // Passo 4 — segundo recheio (pode repetir; aqui escolhe outro)
    await pickOption(user, 'fill-chocolate');
    await clickContinue(user);

    // Passo 5 — extras + humidade (molhado não altera preço)
    await pickOption(user, 'extra-sprinkles');
    await pickOption(user, 'extra-message');
    await user.click(screen.getByRole('radio', { name: 'Molhado' }));
    await clickContinue(user);

    // Passo 6 — revisão: o SERVIDOR confirma o preço (não o cliente)
    expect(await screen.findByRole('heading', { name: /revisão e carrinho/i })).toBeInTheDocument();
    await waitFor(
      () => expect(screen.getByText(/confirmado pelo servidor/i)).toBeInTheDocument(),
      REVIEW_TIMEOUT,
    );
    const add = await screen.findByTestId('add-to-cart', undefined, REVIEW_TIMEOUT);
    expect(add).toBeEnabled();

    await user.click(add);

    // Navega para o carrinho com a linha guardada e o preço do servidor
    expect(await screen.findByText('PAGINA_CARRINHO')).toBeInTheDocument();
    const cart = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) ?? '{}');
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]).toMatchObject({ kind: 'CAKE', unitPrice: '3500.00', quantity: 1 });
    expect(cart.lines[0].summary[0]).toBe('Massa Baunilha');
    expect(cart.lines[0].summary).toContain('Bolo molhado');
    expect(cart.lines[0].composition.cakeBaseId).toBe('base-vanilla');
    expect(cart.lines[0].composition.extraIds).toEqual(['extra-sprinkles', 'extra-message']);
  });

  it('não avança de um passo sem a escolha obrigatória', async () => {
    mockApi();
    const user = userEvent.setup();
    renderStudio();

    const continuar = await screen.findByRole('button', { name: /continuar/i });
    expect(continuar).toBeDisabled();
    const step2 = screen.getByRole('button', { name: /1º recheio/i });
    expect(step2).toBeDisabled();
    await pickOption(user, 'base-chocolate');
    expect(continuar).toBeEnabled();
    expect(screen.getByRole('button', { name: /1º recheio/i })).toBeEnabled();
  });

  it('mantém o botão de adicionar bloqueado quando o servidor rejeita a composição', async () => {
    mockApi({ valid: false, total: '0.00', currency: 'AOA', lines: [], issues: ['Massa: ingrediente indisponível.'] });
    const user = userEvent.setup();
    renderStudio();

    await pickOption(user, 'base-chocolate');
    await clickContinue(user);
    await pickOption(user, 'fill-chocolate');
    await clickContinue(user);
    await clickContinue(user); // passo 3
    await pickOption(user, 'fill-strawberry');
    await clickContinue(user); // passo 4 → 5 (extras)
    await clickContinue(user); // passo 5 → 6 (revisão)

    await waitFor(() => expect(screen.getByText(/indisponível/i)).toBeInTheDocument(), REVIEW_TIMEOUT);
    const add = await screen.findByTestId('add-to-cart', undefined, REVIEW_TIMEOUT);
    expect(add).toBeDisabled();
  });

  it('mostra erro legível e permite tentar novamente se as opções não carregam', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(
        new ApiError(0, 'NETWORK_ERROR', 'Sem ligação ao servidor. Verifique a sua internet.', '/options'),
      )
      .mockImplementation(async () => json(optionsPayload));

    const user = userEvent.setup();
    renderStudio();

    expect(await screen.findByText(/sem ligação ao servidor/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /tentar novamente/i }));
    expect(await screen.findByRole('button', { name: /continuar/i })).toBeInTheDocument();
  });
});
