import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LoyaltyPage } from './LoyaltyPage';
import { resetSession, refreshSession } from '../lib/session';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const USER = { id: 'u1', email: 'ana@example.com', displayName: 'Ana Compradora', phone: null };

const SUMMARY_UNCONFIGURED = {
  configured: false,
  active: false,
  pointsBalance: 0,
  lifetimePoints: 0,
  earnPercent: null,
  pointValueKz: null,
  rounding: null,
  allowPartialRedemption: null,
  welcome: null,
  rewards: [],
};

const SUMMARY_ACTIVE = {
  configured: true,
  active: true,
  pointsBalance: 350,
  lifetimePoints: 350,
  earnPercent: '10.00',
  pointValueKz: '1.0000',
  rounding: 'HALF_UP',
  allowPartialRedemption: true,
  welcome: { eligible: true, percent: '5.00', label: 'Desconto de boas-vindas' },
  rewards: [
    {
      reward: {
        code: 'GOAL_5K',
        description: 'Recompensa de meta',
        minPoints: 10000,
        minOrders: 5,
        discountAmount: '1000.00',
        maxPerCustomer: 1,
        active: true,
      },
      eligible: false,
      reason: 'Recompensa indisponível: ainda precisa de 9650 ponto(s) e ainda precisa de 5 encomenda(s).',
      redeemedCount: 0,
    },
  ],
};

const TRANSACTIONS = [
  {
    type: 'EARN',
    points: 350,
    amountKz: '3500.00',
    rateKind: 'EARN_PERCENT',
    rateUsed: '10.0000',
    orderNumber: 'LC-000001',
    note: 'Encomenda LC-000001 paga',
    createdAt: '2026-10-20T12:00:00Z',
  },
  {
    type: 'REDEEM',
    points: -1000,
    amountKz: '1000.00',
    rateKind: 'POINT_VALUE',
    rateUsed: '1.0000',
    orderNumber: null,
    note: 'Resgate na encomenda LC-000002',
    createdAt: '2026-10-19T12:00:00Z',
  },
];

function mockApi(handlers: {
  me?: unknown;
  loyalty?: unknown;
  loyaltyTransactions?: unknown;
  loyaltyFails?: boolean;
}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url === '/api/v1/csrf') return json({ token: 'token-1' });
    if (url === '/api/v1/auth/me') {
      return handlers.me === undefined ? json({}, 401) : json(handlers.me);
    }
    if (url === '/api/v1/loyalty/transactions') return json(handlers.loyaltyTransactions ?? []);
    if (url === '/api/v1/loyalty') {
      if (handlers.loyaltyFails) return json({ message: 'Falha de rede simulada.' }, 500);
      return json(handlers.loyalty ?? SUMMARY_UNCONFIGURED);
    }
    throw new Error('pedido inesperado: ' + url);
  });
}

function renderLoyalty() {
  return render(
    <MemoryRouter initialEntries={['/fidelizacao']}>
      <Routes>
        <Route path="/fidelizacao" element={<LoyaltyPage />} />
        <Route path="/conta/encomendas/:number" element={<p>Detalhe da encomenda</p>} />
        <Route path="/loja" element={<p>Loja</p>} />
        <Route path="/entrar" element={<p>Ecrã de login</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LoyaltyPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetSession();
  });

  it('sem sessão convida para entrar em vez de mostrar dados', async () => {
    mockApi({});
    await refreshSession();
    renderLoyalty();

    expect(
      await screen.findByRole('button', { name: 'Entrar para ver os meus pontos' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /criar conta/i })).toBeInTheDocument();
  });

  it('programa por configurar é dito honestamente — sem promessas de pontos', async () => {
    mockApi({ me: USER, loyalty: SUMMARY_UNCONFIGURED });
    await refreshSession();
    renderLoyalty();

    expect(await screen.findByText(/o programa ainda não está activo/i)).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText(/recompensa de meta/i)).not.toBeInTheDocument();
    expect(screen.getByText(/ainda não tem movimentos/i)).toBeInTheDocument();
  });

  it('programa activo mostra saldo, elegibilidade com motivo e movimentos', async () => {
    mockApi({ me: USER, loyalty: SUMMARY_ACTIVE, loyaltyTransactions: TRANSACTIONS });
    await refreshSession();
    renderLoyalty();

    // Saldo real do servidor + equivalência pela taxa configurada.
    expect(await screen.findByText('350')).toBeInTheDocument();
    expect(screen.getByText(/equivalente a 350,00 kz/i)).toBeInTheDocument();

    // Boas-vindas: elegível, com a percentagem que a loja configurou.
    expect(screen.getByText('Desconto de boas-vindas')).toBeInTheDocument();
    expect(screen.getByText('Disponível')).toBeInTheDocument();

    // Recompensa indisponível com o MOTIVO — nunca uma promessa vazia.
    expect(screen.getByText('Recompensa de meta')).toBeInTheDocument();
    expect(screen.getByText('Indisponível')).toBeInTheDocument();
    expect(screen.getByText(/ainda precisa de 9650 ponto\(s\)/)).toBeInTheDocument();

    // Movimentos com proveniência e sinal correctos (livro-razão do servidor).
    expect(screen.getByText('Pontos ganhos')).toBeInTheDocument();
    expect(screen.getByText('+350 pts')).toBeInTheDocument();
    expect(screen.getByText('-1000 pts')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'LC-000001' })).toBeInTheDocument();
  });

  it('falha de rede mostra alerta com nova tentativa', async () => {
    mockApi({ me: USER, loyaltyFails: true });
    await refreshSession();
    renderLoyalty();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Falha de rede simulada.');
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });
});
