package com.lisscompany.catalog;

/**
 * Estado de publicação de um produto. Apenas {@link #ACTIVE} é visível na
 * loja pública; DRAFT serve para preparar conteúdo e HIDDEN para retirar sem
 * apagar (preserva referências históricas quando existirem encomendas).
 */
public enum ProductStatus {
    DRAFT,
    ACTIVE,
    HIDDEN
}
