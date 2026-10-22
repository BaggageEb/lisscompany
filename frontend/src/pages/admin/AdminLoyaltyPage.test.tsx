import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AdminLoyaltyPage } from './AdminLoyaltyPage';
import { resetSession, refreshSession } from '../../lib/session';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const OWNER = { id: 'u1', email: 'dona@example.com', displayName: 'Dona', phone: null, owner: true };

const UNCONFIGURED = { rule: null, rewards: [] };

const CONFIGURED = {
  rule: {
    earnPercent: '10.00',
    pointValueKz: '1.0000',
    rounding: 'HALF_UP',
    allowPartialRedemption: true,
    active: true,
    updatedAt: '2026-10-22T10:00:00Z',
  },
  rewards: [],
};

function mockApi(handlers: {
  me?: unknown;
  config?: unknown;
  configCalls?: { url: string; method: string; body?: string }[];
}) {
  const calls: { url: string; method: string; body?: string }[] = [];
  let configServed = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({ url, method, ...(body ? { body } : {}) });
    if (url === '/api/v1/csrf') return json({ token: 'token-1' });
    if (url === '/api/v1/auth/me') {
      return handlers.me === undefined ? json({}, 401) : json(handlers.me);
    }
    if (url === '/api/v1/admin/loyalty/config/rule' && method === 'PUT') {
      return json(CONFIGURED.rule);
    }
    if (url === '/api/v1/admin/loyalty/config/rewards' && method === 'POST') {
      return json({
        code: 'META_5K',
        description: 'Recompensa de meta',
        minPoints: 5000,
        minOrders: null,
        discountAmount: '1000.00',
        maxPerCustomer: 1,
        active: true,
      });
    }
    if (url === '/api/v1/admin/loyalty/config/discounts') return json([]);
    if (url === '/api/v1/admin/loyalty/accounts') return json([]);
    if (url === '/api/v1/admin/loyalty/config') {
      // Primeira carga: o estado configurado; depois da gravação, o guardado.
      configServed += 1;
      return json(configServed > 1 && !handlers.config ? CONFIGURED : (handlers.config ?? UNCONFIGURED));
    }
    throw new Error('pedido inesperado: ' + method + ' ' + url);
  });
  return calls;
}

function renderLoyaltyPanel() {
  return render(
    <MemoryRouter initialEntries={['/admin/fidelizacao']}>
      <Routes>
        <Route path="/admin/fidelizacao" element={<AdminLoyaltyPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('painel: fidelização', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetSession();
  });

  it('sem regra configurada diz honestamente que o programa por configurar', async () => {
    mockApi({ me: OWNER });
    await refreshSession();
    renderLoyaltyPanel();

    expect(await screen.findByText(/programa por configurar/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Percentagem acumulada/)).toBeInTheDocument();
    expect(screen.getByText(/Ainda não há recompensas/)).toBeInTheDocument();
  });

  it('guardar a regra envia os valores ao servidor e o formulário reflecte o guardado', async () => {
    const user = userEvent.setup();
    const calls = mockApi({ me: OWNER });
    await refreshSession();
    renderLoyaltyPanel();

    await screen.findByText(/programa por configurar/i);
    await user.clear(screen.getByLabelText(/Percentagem acumulada/));
    await user.type(screen.getByLabelText(/Percentagem acumulada/), '10');
    await user.clear(screen.getByLabelText(/Valor de 1 ponto/));
    await user.type(screen.getByLabelText(/Valor de 1 ponto/), '1');
    await user.click(screen.getByRole('button', { name: 'Guardar regra' }));

    await waitFor(() => {
      const put = calls.find(
        (call) => call.method === 'PUT' && call.url === '/api/v1/admin/loyalty/config/rule',
      );
      expect(put).toBeDefined();
      expect(JSON.parse(put!.body ?? '{}')).toMatchObject({
        earnPercent: '10',
        pointValueKz: '1',
        rounding: 'HALF_UP',
        allowPartialRedemption: true,
        active: true,
      });
    });

    expect(await screen.findByRole('status')).toHaveTextContent('Regra de fidelização guardada.');
  });

  it('criar recompensa usa o código enviado pelo painel (o cliente nunca vê UUIDs)', async () => {
    const user = userEvent.setup();
    const calls = mockApi({ me: OWNER, config: CONFIGURED });
    await refreshSession();
    renderLoyaltyPanel();

    await screen.findByText(/Nova \/ editar recompensa/);
    await user.type(screen.getByLabelText('Código'), 'meta_5k');
    await user.type(screen.getByLabelText('Descrição (o que o cliente vê)'), 'Recompensa de meta');
    await user.type(screen.getByLabelText('Desconto em Kz'), '1000');
    await user.type(screen.getByLabelText('Mínimo de pontos (condição)'), '5000');
    await user.click(screen.getByRole('button', { name: 'Guardar recompensa' }));

    await waitFor(() => {
      const post = calls.find(
        (call) => call.method === 'POST' && call.url === '/api/v1/admin/loyalty/config/rewards',
      );
      expect(post).toBeDefined();
      expect(JSON.parse(post!.body ?? '{}')).toMatchObject({
        code: 'META_5K',
        minPoints: 5000,
        discountAmount: '1000',
        active: true,
      });
    });
  });

  it('mostra as recompensas existentes com condições e estado', async () => {
    mockApi({
      me: OWNER,
      config: {
        rule: CONFIGURED.rule,
        rewards: [
          {
            code: 'META_5K',
            description: 'Recompensa de meta',
            minPoints: 5000,
            minOrders: 5,
            discountAmount: '1000.00',
            maxPerCustomer: 1,
            active: true,
          },
        ],
      },
    });
    await refreshSession();
    renderLoyaltyPanel();

    expect(await screen.findByText('Recompensa de meta')).toBeInTheDocument();
    expect(screen.getByText(/5000 pontos e 5 encomendas/)).toBeInTheDocument();
    expect(screen.getByText('Activa')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument();
  });
});
