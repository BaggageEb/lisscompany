import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LoginPage } from './LoginPage';
import { ApiError } from '../lib/api';
import { resetSession } from '../lib/session';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const USER = { id: 'u1', email: 'ana@example.com', displayName: 'Ana Compradora', phone: null };

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/entrar', state: { from: '/painel' } }]}>
      <Routes>
        <Route path="/entrar" element={<LoginPage />} />
        <Route path="/painel" element={<p>Painel de destino</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/e-mail/i), 'ana@example.com');
  await user.type(screen.getByLabelText(/^palavra-passe/i), 'senha-forte-1234');
  await user.click(screen.getByRole('button', { name: 'Entrar' }));
}

describe('LoginPage', () => {
  beforeEach(() => {
    // O estado de sessão é do módulo: sem este reset, o login do teste
    // anterior deixaria a página a redirecionar antes do formulário existir.
    resetSession();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('entra e navega para o destino pedido (ex.: checkout)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === '/api/v1/csrf') return json({ token: 'token-1' });
      if (url === '/api/v1/auth/login') {
        // O login leva o token CSRF obtido antes.
        expect(new Headers(init?.headers).get('X-CSRF-TOKEN')).toBe('token-1');
        return json(USER);
      }
      throw new Error('pedido inesperado: ' + url);
    });
    const user = userEvent.setup();
    renderLogin();

    await fillAndSubmit(user);

    expect(await screen.findByText('Painel de destino')).toBeInTheDocument();
  });

  it('mostra a falha de credenciais sem revelar mais nada', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/v1/csrf') return json({ token: 'token-1' });
      if (url === '/api/v1/auth/login') {
        return json(
          {
            status: 401,
            code: 'INVALID_CREDENTIALS',
            message: 'Credenciais inválidas. Verifique o e-mail e a palavra-passe.',
            path: url,
            fieldErrors: {},
          },
          401,
        );
      }
      throw new Error('pedido inesperado: ' + url);
    });
    const user = userEvent.setup();
    renderLogin();

    await fillAndSubmit(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Credenciais inválidas. Verifique o e-mail e a palavra-passe.');
    // Continua no formulário — nada de «bem-vindo» fictício.
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeEnabled();
  });

  it('mostra erros por campo vindos do envelope', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/v1/csrf') return json({ token: 'token-1' });
      if (url === '/api/v1/auth/login') {
        throw new ApiError(400, 'VALIDATION_FAILED', 'Dados inválidos.', url, { email: 'E-mail em falta.' });
      }
      throw new Error('pedido inesperado: ' + url);
    });
    const user = userEvent.setup();
    renderLogin();

    // Submete sem preencher: o backend valida e devolve erros por campo.
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByText('E-mail em falta.')).toBeInTheDocument();
  });

  beforeEach(() => {
    localStorage.clear();
  });
});
