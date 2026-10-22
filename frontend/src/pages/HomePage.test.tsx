import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { HomePage } from './HomePage';
import { ApiError } from '../lib/api';

function renderHome() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

describe('HomePage', () => {
  beforeEach(() => {
    vi.stubGlobal('scrollTo', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('apresenta a identidade, o slogan e a entrada principal do Cake Studio', () => {
    renderHome();
    expect(
      screen.getByRole('heading', { level: 1, name: /construído camada a camada/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /abrir o cake studio/i })).toHaveAttribute('href', '/cake-studio');
    expect(screen.getByRole('link', { name: /ver a loja/i })).toHaveAttribute('href', '/loja');
  });

  it('mostra estado de carregamento e depois "loja online" quando a API responde UP', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'UP' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderHome();

    expect(screen.getByText(/a verificar ligação à loja/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/loja online/i)).toBeInTheDocument();
    });
  });

  it('mostra estado de erro legível quando a API está inacessível', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new ApiError(0, 'NETWORK_ERROR', 'Sem ligação ao servidor. Verifique a sua internet.', '/actuator/health'),
    );

    renderHome();

    await waitFor(() => {
      expect(screen.getByText(/servidor em manutenção/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/sem ligação ao servidor/i)).toBeInTheDocument();
  });

  it('navega para o Cake Studio a partir do destaque', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'UP' }), { status: 200 }),
    );

    renderHome();
    await user.click(screen.getAllByRole('link', { name: /começar a criar/i })[0]);
    // A navegação é validada pela rota; aqui garantimos que o link é funcional.
    expect(screen.getAllByRole('link', { name: /começar a criar/i })[0]).toHaveAttribute('href', '/cake-studio');
  });
});
