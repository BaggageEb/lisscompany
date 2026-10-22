/**
 * Estado de sessão do cliente (fase 4).
 *
 * A sessão vive no cookie do servidor; aqui guardamos apenas o resultado de
 * `GET /api/v1/auth/me` para a UI reagir. O backend continua a ser quem
 * decide: qualquer rota privada responde 401 sem sessão válida, mesmo que a
 * UI ache que o utilizador está autenticado.
 */
import { useSyncExternalStore } from 'react';

import { fetchMe, invalidateCsrfToken, login as loginApi, logout as logoutApi, registerAccount as registerApi, type AuthUser } from './api';

export type SessionState =
  | { kind: 'loading' }
  | { kind: 'anonymous' }
  | { kind: 'authenticated'; user: AuthUser };

let state: SessionState = { kind: 'loading' };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function set(next: SessionState): SessionState {
  state = next;
  emit();
  return state;
}

export function getSessionState(): SessionState {
  return state;
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Verifica a sessão no servidor (chamada no arranque da aplicação). */
export async function refreshSession(): Promise<SessionState> {
  try {
    const user = await fetchMe();
    return set({ kind: 'authenticated', user });
  } catch (error) {
    // 401 é o caso normal (sem cookie ou expirado). Qualquer outro erro também
    // resulta em «anónimo» de propósito: as rotas privadas voltam a pedir login
    // e o backend continua a ser quem autoriza de verdade.
    void error;
    return set({ kind: 'anonymous' });
  }
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const user = await loginApi({ email, password });
  set({ kind: 'authenticated', user });
  return user;
}

export async function register(input: { email: string; displayName: string; password: string; phone?: string }): Promise<AuthUser> {
  const user = await registerApi(input);
  set({ kind: 'authenticated', user });
  return user;
}

export async function logout(): Promise<void> {
  try {
    await logoutApi();
  } finally {
    // Mesmo que o pedido falhe, o cliente passa a anónimo e descarta o token.
    invalidateCsrfToken();
    set({ kind: 'anonymous' });
  }
}

/**
 * Repõe o estado inicial. O estado de sessão vive no módulo (partilhado por
 * toda a UI), por isso os testes que simulam um login têm de o limpar antes
 * do seguinte — caso contrário o utilizador «fictício» atravessa os testes.
 */
export function resetSession(): void {
  invalidateCsrfToken();
  set({ kind: 'anonymous' });
}

/** Hook de react: o estado é partilhado e estável (mesmo padrão do carrinho). */
export function useSession(): SessionState {
  return useSyncExternalStore(subscribeSession, getSessionState, getSessionState);
}
