import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ForgotPasswordPage } from './ForgotPasswordPage';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('ForgotPasswordPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('responde sempre com a mesma mensagem neutra', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input) === '/api/v1/csrf') return json({ token: 't' });
      return new Response(null, { status: 202 });
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ForgotPasswordPage />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText('E-mail'), 'qualquer@exemplo.pt');
    await user.click(screen.getByRole('button', { name: 'Enviar instruções' }));
    expect(await screen.findByText(/Se existir uma conta com esse e-mail/)).toBeInTheDocument();
  });
});
