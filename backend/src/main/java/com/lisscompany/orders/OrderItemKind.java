package com.lisscompany.orders;

/** Espécie de linha da encomenda — espelha as espécies do carrinho. */
public enum OrderItemKind {
    /** Produto pronto do catálogo (guarda referência + snapshot de nome/preço). */
    PRODUCT,
    /** Criação do Cake Studio (guarda a composição em snapshot). */
    CAKE
}
