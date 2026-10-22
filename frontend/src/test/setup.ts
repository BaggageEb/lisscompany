import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom não implementa AbortSignal.timeout (disponível em navegadores e Node).
// O cliente de API já cai num AbortController como alternativa portátil, mas o
// polyfill aqui garante que testes de API não dependem de jsdom ter o método.
if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout !== 'function') {
  const timeoutFn = (ms: number): AbortSignal => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  };
  (AbortSignal as { timeout?: typeof timeoutFn }).timeout = timeoutFn;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
