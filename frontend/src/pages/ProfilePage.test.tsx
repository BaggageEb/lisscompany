import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProfilePage } from './ProfilePage';
import { resetSession, refreshSession } from '../lib/session';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function noContent() {
  return new Response(null, { status: 204 });
}

const USER = { id: 'u1', email: 'ana@example.com', displayName: 'Ana Perfil', phone: '912345678' };
const PROFILE = { id: 'u1', email: 'ana@example.com', displayName: 'Ana Perfil', phone: '912345678' };

const CREATED_ADDRESS = {
  id: 'a1',
  label: 'Casa',
  recipientName: 'Ana',
  line1: 'Rua Exemplo, 12',
  line2: null,
  city: 'Luanda',
  municipality: null,
  province: null,
  phone: null,
  isDefault: true,
};

function mockApi(handlers: {
  me?: unknown;
  profile?: () => Response;
  addresses?: unknown;
  sessions?: unknown;
  saveProfile?: () => Response;
  changePassword?: () => Response;
  createAddress?: () => Response;
}) {
  const calls: { url: string; method: string; body?: string }[] = [];
  let addresses = Array.isArray(handlers.addresses) ? [...(handlers.addresses as unknown[])] : [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({ url, method, ...(body ? { body } : {}) });
    if (url === '/api/v1/csrf') return json({ token: 'token-1' });
    if (url === '/api/v1/auth/me') {
      return handlers.me === undefined ? json({}, 401) : json(handlers.me);
    }
    if (url.startsWith('/api/v1/auth/sessions/') && method === 'POST') {
      return noContent();
    }
    if (url === '/api/v1/auth/sessions') {
      return json(handlers.sessions ?? []);
    }
    if (url === '/api/v1/account/profile' && method === 'PUT') {
      if (handlers.saveProfile) return handlers.saveProfile();
      const parsed = JSON.parse(body ?? '{}') as { displayName: string; phone?: string };
      return json({ ...PROFILE, displayName: parsed.displayName, phone: parsed.phone ?? null });
    }
    if (url === '/api/v1/account/profile') {
      return handlers.profile ? handlers.profile() : json(PROFILE);
    }
    if (url === '/api/v1/account/change-password') {
      return handlers.changePassword ? handlers.changePassword() : noContent();
    }
    if (url === '/api/v1/account/addresses' && method === 'POST') {
      if (handlers.createAddress) return handlers.createAddress();
      const parsed = JSON.parse(body ?? '{}') as { label?: string; line1: string; city: string };
      const created = { ...CREATED_ADDRESS, label: parsed.label ?? null, line1: parsed.line1, city: parsed.city };
      addresses = [created];
      return json(created, 201);
    }
    if (url === '/api/v1/account/addresses' && method === 'GET') {
      return json(addresses);
    }
    if (url.startsWith('/api/v1/account/addresses/') && method === 'DELETE') {
      addresses = [];
      return noContent();
    }
    if (url.startsWith('/api/v1/account/addresses/')) {
      return json(CREATED_ADDRESS);
    }
    throw new Error('pedido inesperado: ' + method + ' ' + url);
  });
  return calls;
}

function renderProfile() {
  return render(
    <MemoryRouter initialEntries={['/conta/perfil']}>
      <Routes>
        <Route path="/conta/perfil" element={<ProfilePage />} />
        <Route path="/conta" element={<p>Área do cliente</p>} />
        <Route path="/entrar" element={<p>Ecrã de login</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProfilePage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetSession();
  });

  it('guarda os dados de contacto e a sessão passa a reflectir o servidor', async () => {
    const user = userEvent.setup();
    const calls = mockApi({ me: USER });
    await refreshSession();
    renderProfile();

    const nameInput = await screen.findByLabelText('Nome a mostrar');
    expect(nameInput).toHaveValue('Ana Perfil');

    await user.clear(nameInput);
    await user.type(nameInput, 'Ana Actualizada');
    await user.click(screen.getByRole('button', { name: 'Guardar dados' }));

    await waitFor(() => {
      const put = calls.find(
        (call) => call.method === 'PUT' && call.url === '/api/v1/account/profile',
      );
      expect(put).toBeDefined();
      expect(JSON.parse(put!.body ?? '{}')).toMatchObject({
        displayName: 'Ana Actualizada',
        phone: '912345678',
      });
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Dados guardados.');

    // A sessão é relida do servidor depois de guardar (fonte de verdade).
    await waitFor(() => {
      expect(calls.filter((call) => call.url === '/api/v1/auth/me').length).toBeGreaterThanOrEqual(2);
    });
  });

  it('palavra-passe: a repetição diferente é avisada sem chegar ao servidor', async () => {
    const user = userEvent.setup();
    const calls = mockApi({ me: USER });
    await refreshSession();
    renderProfile();

    await screen.findByLabelText('Nome a mostrar');
    await user.type(screen.getByLabelText('Palavra-passe actual'), 'senha-actual-123');
    await user.type(screen.getByLabelText('Nova palavra-passe'), 'nova-senha-456');
    await user.type(screen.getByLabelText('Repetir nova palavra-passe'), 'diferente-qualquer');
    await user.click(screen.getByRole('button', { name: 'Alterar palavra-passe' }));

    expect(await screen.findByText('As duas palavras-passe não coincidem.')).toBeInTheDocument();
    expect(calls.some((call) => call.url === '/api/v1/account/change-password')).toBe(false);
  });

  it('palavra-passe: alteração válida chega ao servidor e limpa os campos', async () => {
    const user = userEvent.setup();
    const calls = mockApi({ me: USER });
    await refreshSession();
    renderProfile();

    await screen.findByLabelText('Nome a mostrar');
    await user.type(screen.getByLabelText('Palavra-passe actual'), 'senha-actual-123');
    await user.type(screen.getByLabelText('Nova palavra-passe'), 'nova-senha-456');
    await user.type(screen.getByLabelText('Repetir nova palavra-passe'), 'nova-senha-456');
    await user.click(screen.getByRole('button', { name: 'Alterar palavra-passe' }));

    await waitFor(() => {
      const post = calls.find(
        (call) => call.method === 'POST' && call.url === '/api/v1/account/change-password',
      );
      expect(post).toBeDefined();
      expect(JSON.parse(post!.body ?? '{}')).toMatchObject({
        currentPassword: 'senha-actual-123',
        newPassword: 'nova-senha-456',
      });
    });

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Palavra-passe alterada.');
    expect(screen.getByLabelText('Palavra-passe actual')).toHaveValue('');
  });

  it('erro do servidor na palavra-passe aparece no campo (palavra-passe actual errada)', async () => {
    const user = userEvent.setup();
    mockApi({
      me: USER,
      changePassword: () =>
        json(
          {
            status: 400,
            code: 'VALIDATION_FAILED',
            message: 'Dados inválidos.',
            path: '/api/v1/account/change-password',
            fieldErrors: { currentPassword: 'A palavra-passe actual não corresponde.' },
          },
          400,
        ),
    });
    await refreshSession();
    renderProfile();

    await screen.findByLabelText('Nome a mostrar');
    await user.type(screen.getByLabelText('Palavra-passe actual'), 'errada-qualquer');
    await user.type(screen.getByLabelText('Nova palavra-passe'), 'nova-senha-456');
    await user.type(screen.getByLabelText('Repetir nova palavra-passe'), 'nova-senha-456');
    await user.click(screen.getByRole('button', { name: 'Alterar palavra-passe' }));

    expect(await screen.findByText('A palavra-passe actual não corresponde.')).toBeInTheDocument();
  });

  it('lista as sessões activas e só permite terminar as outras', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      me: USER,
      sessions: [
        { handle: 's-current', createdAt: '2026-10-22T10:00:00Z', current: true },
        { handle: 's-other', createdAt: '2026-10-21T09:00:00Z', current: false },
      ],
    });
    await refreshSession();
    renderProfile();

    expect(await screen.findByText('Esta sessão')).toBeInTheDocument();
    expect(screen.getByText('Outro dispositivo')).toBeInTheDocument();
    // Só a sessão de OUTRO dispositivo tem botão de terminar.
    const endButtons = screen.getAllByRole('button', { name: 'Terminar sessão' });
    expect(endButtons).toHaveLength(1);

    await user.click(endButtons[0]);
    await waitFor(() => {
      const revoke = calls.find(
        (call) =>
          call.method === 'POST' && call.url.includes('/api/v1/auth/sessions/s-other/revoke'),
      );
      expect(revoke).toBeDefined();
    });
  });

  it('cria uma morada e aparece na lista com a marcação de predefinida', async () => {
    const user = userEvent.setup();
    const calls = mockApi({ me: USER, addresses: [] });
    await refreshSession();
    renderProfile();

    await screen.findByText('Ainda não tem moradas guardadas.');
    await user.click(screen.getByRole('button', { name: 'Adicionar morada' }));

    await user.type(screen.getByLabelText('Morada (linha 1)'), 'Rua Exemplo, 12');
    await user.type(screen.getByLabelText('Cidade'), 'Luanda');
    await user.type(screen.getByLabelText('Etiqueta (opcional)'), 'Casa');
    await user.click(screen.getByRole('button', { name: 'Guardar morada' }));

    await waitFor(() => {
      const post = calls.find(
        (call) => call.method === 'POST' && call.url === '/api/v1/account/addresses',
      );
      expect(post).toBeDefined();
      expect(JSON.parse(post!.body ?? '{}')).toMatchObject({ line1: 'Rua Exemplo, 12', city: 'Luanda' });
    });

    expect(await screen.findByText(/Rua Exemplo, 12/)).toBeInTheDocument();
    expect(screen.getByText('Predefinida')).toBeInTheDocument();
  });

  it('remover morada pede confirmação antes de apagar', async () => {
    const user = userEvent.setup();
    const calls = mockApi({ me: USER, addresses: [CREATED_ADDRESS] });
    await refreshSession();
    renderProfile();

    await screen.findByText(/Rua Exemplo, 12/);
    await user.click(screen.getByRole('button', { name: 'Remover' }));
    // Ainda não apagou: esperou pela confirmação.
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);

    const confirmButtons = screen.getAllByRole('button', { name: 'Remover' });
    await user.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => {
      expect(calls.some((call) => call.method === 'DELETE' && call.url.includes('/a1'))).toBe(true);
    });
    expect(await screen.findByText('Ainda não tem moradas guardadas.')).toBeInTheDocument();
  });
});
