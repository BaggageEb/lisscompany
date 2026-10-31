import { useEffect, useState } from 'react';
import { fetchStoreInfo, type StoreInfo } from './api';

let cached: Promise<StoreInfo> | null = null;

/**
 * Informação pública da loja (contactos, políticas, zonas). Guardada em
 * memória durante a sessão de navegação; devolve `null` enquanto carrega ou
 * se o servidor não responder — a UI nunca inventa dados em falta.
 */
export function useStoreInfo(): StoreInfo | null {
  const [info, setInfo] = useState<StoreInfo | null>(null);
  useEffect(() => {
    let alive = true;
    cached ??= fetchStoreInfo();
    cached
      .then((value) => {
        if (alive) setInfo(value);
      })
      .catch(() => {
        cached = null; // permite nova tentativa na próxima navegação
      });
    return () => {
      alive = false;
    };
  }, []);
  return info;
}

/** Só para testes: limpa a cache em memória. */
export function resetStoreInfoCache(): void {
  cached = null;
}
