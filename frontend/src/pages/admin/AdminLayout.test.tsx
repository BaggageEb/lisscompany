import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AdminLayout } from './AdminLayout';
import { refreshSession, resetSession } from '../../lib/session';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function signInAs(user: Record<string, unknown>) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url === '/api/v1/auth/me') return json(user);
    return json({}, 404);
  });
  await refreshSession();
}

function renderAdmin() {
  return render(
    <MemoryRouter initialEntries={['/admin/encomendas']}>
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route path="encomendas" element={<p>Lista de encomendas</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminLayout', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetSession();
  });

  it('a proprietária vê todas as secções, incluindo equipa e definições', async () => {
    await signInAs({ id: 'o', email: 'dona@x.pt', displayName: 'Dona', owner: true, permissions: [] });
    renderAdmin();
    expect(await screen.findByRole('link', { name: /Bolos e produtos/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Definições/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Equipa e acessos/ })).toBeInTheDocument();
  });

  it('uma conta secundária só vê as secções das suas permissões', async () => {
    await signInAs({ id: 's', email: 'c@x.pt', displayName: 'Colab', owner: false, permissions: ['ORDERS_VIEW', 'DASHBOARD_VIEW'] });
    renderAdmin();
    expect(await screen.findByRole('link', { name: /Encomendas/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Definições/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Equipa e acessos/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Bolos e produtos/ })).not.toBeInTheDocument();
  });

  it('um cliente comum recebe a mensagem de sem permissão', async () => {
    await signInAs({ id: 'c', email: 'cli@x.pt', displayName: 'Cliente', owner: false, permissions: [] });
    renderAdmin();
    expect(await screen.findByRole('alert')).toHaveTextContent(/não tem permissão/i);
  });
});
