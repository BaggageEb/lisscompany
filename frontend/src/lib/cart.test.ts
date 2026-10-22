import { beforeEach, describe, expect, it } from 'vitest';
import {
  addCartLine,
  cartQuantity,
  cartTotal,
  clearCart,
  EMPTY_CART,
  getCart,
  removeCartLine,
  updateCartQuantity,
  type CakeCartLine,
  type ProductCartLine,
} from './cart';

function product(id: string, price: string, quantity = 1): ProductCartLine {
  return { kind: 'PRODUCT', productId: id, slug: id, name: `Produto ${id}`, unitPrice: price, quantity };
}

function cake(unitPrice: string, quantity = 1): CakeCartLine {
  return {
    kind: 'CAKE',
    name: 'Bolo no Pote personalizado',
    summary: ['Massa chocolate', 'Recheio morango ×2'],
    unitPrice,
    quantity,
    composition: {
      cakeBaseId: 'base-chocolate',
      firstFillingId: 'fill-strawberry',
      secondFillingId: 'fill-strawberry',
      extraIds: [],
      moist: false,
    },
  };
}

beforeEach(() => {
  clearCart();
});

describe('carrinho local', () => {
  it('começa vazio', () => {
    expect(getCart()).toEqual(EMPTY_CART);
    expect(cartQuantity()).toBe(0);
    expect(cartTotal()).toBe('0.00');
  });

  it('acrescenta linhas e soma quantidades de produtos idênticos', () => {
    addCartLine(product('bolo-vanilla', '2500.00'));
    addCartLine(product('bolo-vanilla', '2500.00', 2));
    const cart = getCart();
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0].quantity).toBe(3);
    expect(cartQuantity()).toBe(3);
  });

  it('criações de bolo nunca agregam — cada uma é única', () => {
    addCartLine(cake('5500.00'));
    addCartLine(cake('4800.00'));
    expect(getCart().lines).toHaveLength(2);
  });

  it('calcula o total sem deriva de ponto flutuante', () => {
    addCartLine(product('a', '0.10', 3)); // 0.30
    addCartLine(product('b', '2500.55')); // 2500.55
    addCartLine(cake('5500.00', 2)); // 11000.00
    expect(cartTotal()).toBe('13500.85');
  });

  it('actualiza quantidade e remove ao chegar a zero', () => {
    addCartLine(product('a', '100.00'));
    addCartLine(product('b', '200.00'));
    updateCartQuantity(0, 5);
    expect(getCart().lines[0].quantity).toBe(5);
    updateCartQuantity(0, 0);
    expect(getCart().lines).toHaveLength(1);
    expect(getCart().lines[0]).toMatchObject({ slug: 'b' });
    removeCartLine(0);
    expect(getCart().lines).toHaveLength(0);
  });

  it('ignora índices inválidos sem partir', () => {
    addCartLine(product('a', '100.00'));
    expect(updateCartQuantity(9, 2).lines).toHaveLength(1);
    expect(removeCartLine(-1).lines).toHaveLength(1);
  });

  it('persiste e recarrega a partir do localStorage', () => {
    addCartLine(product('a', '123.45', 2));
    // Simula remoção da referência em memória: o próximo get relê do storage.
    const raw = localStorage.getItem('lisscompany.cart.v1');
    expect(raw).toBeTruthy();
    const reloaded = JSON.parse(raw ?? '{}');
    expect(reloaded.lines[0].unitPrice).toBe('123.45');
  });

  it('recupera de JSON corrompido voltando ao carrinho vazio', () => {
    localStorage.setItem('lisscompany.cart.v1', '{not-json');
    expect(getCart().lines).toEqual([]);
  });
});
