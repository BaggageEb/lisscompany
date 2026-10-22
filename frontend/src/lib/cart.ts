/**
 * Carrinho de compras local (a fase de encomendas sincroniza com o servidor).
 *
 * Enquanto não existe conta de cliente nem carrinho servidor-side, o carrinho
 * vive no `localStorage` e é puramente uma conveniência de navegação: nada
 * aqui é autoridade para preço, stock ou elegibilidade — no checkout o
 * backend revalida e recalcula tudo antes de criar a encomenda.
 *
 * Duas espécies de linha:
 *  - PRODUCT: produto pronto do catálogo;
 *  - CAKE: criação do Cake Studio, guardada com um *snapshot* da composição e
 *    do preço estimado no momento da adição (o servidor confirma depois).
 */
import type { CakeComposition } from './cakeStudio/types';
import type { CartQuoteCakeLine, CartQuoteProductLine } from './api';

export const CART_STORAGE_KEY = 'lisscompany.cart.v1';

export interface ProductCartLine {
  kind: 'PRODUCT';
  productId: string;
  slug: string;
  name: string;
  /** Preço unitário em decimal string (Kz) no momento da adição. */
  unitPrice: string;
  quantity: number;
  imageUrl?: string | null;
}

export interface CakeCartLine {
  kind: 'CAKE';
  /** Id atribuído pelo backend na confirmação da configuração (fase 4). */
  configurationId?: string | null;
  name: string;
  /** Descrição legível da composição, ex.: ["Massa chocolate", "Recheio morango ×2"]. */
  summary: string[];
  /** Preço estimado em decimal string (Kz); o servidor revalida no checkout. */
  unitPrice: string;
  quantity: number;
  composition: CakeComposition;
}

export type CartLine = ProductCartLine | CakeCartLine;

export interface Cart {
  lines: CartLine[];
  updatedAt: string | null;
}

export const EMPTY_CART: Cart = { lines: [], updatedAt: null };

let memoryCart: Cart = EMPTY_CART;
const listeners = new Set<(cart: Cart) => void>();

/**
 * Instantâneo em cache: `getCart()` devolve sempre a *mesma referência* enquanto
 * o conteúdo não muda. Sem isto, `useSyncExternalStore` veria um objecto novo
 * em cada leitura e re-renderizaria o componente sem parar.
 */
let cachedRaw: string | null = null;
let cachedSnapshot: Cart = EMPTY_CART;

function parseCart(raw: string | null): Cart {
  if (!raw) return EMPTY_CART;
  try {
    const parsed = JSON.parse(raw) as Cart;
    if (!parsed || !Array.isArray(parsed.lines)) return EMPTY_CART;
    return { lines: parsed.lines, updatedAt: parsed.updatedAt ?? null };
  } catch {
    // Carrinho corrompido: recomeça vazio em vez de partir a aplicação.
    return EMPTY_CART;
  }
}

function commit(cart: Cart): Cart {
  memoryCart = cart;
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = JSON.stringify(cart);
      localStorage.setItem(CART_STORAGE_KEY, raw);
      cachedRaw = raw;
      cachedSnapshot = cart;
    } catch {
      // Quota cheia/inacessível: mantém pelo menos o estado em memória.
    }
  }
  for (const listener of listeners) listener(cart);
  return cart;
}

export function getCart(): Cart {
  if (typeof localStorage === 'undefined') return memoryCart;
  const raw = localStorage.getItem(CART_STORAGE_KEY);
  if (raw === cachedRaw) return cachedSnapshot;
  cachedRaw = raw;
  cachedSnapshot = parseCart(raw);
  return cachedSnapshot;
}

/** Subscreve a alterações do carrinho; devolve a função de cancelamento. */
export function subscribeCart(listener: (cart: Cart) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function addCartLine(line: CartLine): Cart {
  const cart = getCart();
  // Produtos idênticos agregam quantidade; criações de bolo nunca agregam
  // (cada uma tem composição própria).
  const existing =
    line.kind === 'PRODUCT'
      ? cart.lines.find((l) => l.kind === 'PRODUCT' && l.productId === line.productId)
      : undefined;
  if (existing) {
    existing.quantity += line.quantity;
    return commit({ lines: [...cart.lines], updatedAt: new Date().toISOString() });
  }
  return commit({ lines: [...cart.lines, line], updatedAt: new Date().toISOString() });
}

export function updateCartQuantity(index: number, quantity: number): Cart {
  const cart = getCart();
  if (index < 0 || index >= cart.lines.length) return cart;
  const lines = [...cart.lines];
  if (quantity <= 0) {
    lines.splice(index, 1);
  } else {
    lines[index] = { ...lines[index], quantity };
  }
  return commit({ lines, updatedAt: new Date().toISOString() });
}

export function removeCartLine(index: number): Cart {
  return updateCartQuantity(index, 0);
}

export function clearCart(): Cart {
  return commit(EMPTY_CART);
}

export function cartQuantity(cart: Cart = getCart()): number {
  return cart.lines.reduce((sum, line) => sum + line.quantity, 0);
}

/**
 * Pedido de orçamento do carrinho: manda APENAS identificadores e quantidades.
 * Preços nunca saem daqui — o servidor é quem os decide (orçamento e checkout).
 */
export function buildQuoteRequest(cart: Cart = getCart()): {
  productLines: CartQuoteProductLine[];
  cakeLines: CartQuoteCakeLine[];
} {
  const productLines: CartQuoteProductLine[] = [];
  const cakeLines: CartQuoteCakeLine[] = [];
  for (const line of cart.lines) {
    if (line.kind === 'PRODUCT') {
      productLines.push({ productId: line.productId, quantity: line.quantity });
    } else {
      cakeLines.push({
        cakeBaseId: line.composition.cakeBaseId ?? '',
        firstFillingId: line.composition.firstFillingId ?? '',
        secondFillingId: line.composition.secondFillingId ?? '',
        extraIds: line.composition.extraIds,
        moist: line.composition.moist,
        quantity: line.quantity,
      });
    }
  }
  return { productLines, cakeLines };
}

/** Soma das linhas em unidades mínimas (cêntimos) — sem ponto flutuante. */
export function cartTotalMinor(cart: Cart = getCart()): number {
  return cart.lines.reduce((sum, line) => sum + decimalToMinor(line.unitPrice) * line.quantity, 0);
}

export function cartTotal(cart: Cart = getCart()): string {
  const units = cartTotalMinor(cart);
  return `${Math.floor(units / 100)}.${String(units % 100).padStart(2, '0')}`;
}

function decimalToMinor(decimal: string): number {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(decimal.trim());
  if (!match) return 0;
  const [, intPart, fracPart = ''] = match;
  return Number(intPart) * 100 + Number(`${fracPart}00`.slice(0, 2));
}
