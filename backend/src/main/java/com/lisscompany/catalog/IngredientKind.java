package com.lisscompany.catalog;

/** Tipo de ingrediente do Cake Studio. */
public enum IngredientKind {
    /** Massa do bolo — exactamente a mesma variedade nas duas camadas. */
    CAKE_BASE,
    /** Recheio — até duas camadas, no máximo {@code maxDistinctFillings} distintos. */
    FILLING,
    /** Extra opcional — zero a {@code maxExtras}. */
    EXTRA
}
