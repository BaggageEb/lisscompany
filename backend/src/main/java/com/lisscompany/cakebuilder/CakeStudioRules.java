package com.lisscompany.cakebuilder;

/**
 * Regras fixas do configurador, expressas uma única vez (fonte de verdade do
 * servidor). O frontend exibe a cópia servida por {@code /cake-studio/options}
 * e valida localmente para orientar o cliente — mas estas constantes são quem
 * decide o que é aceite.
 *
 * @param cakeLayers          exactamente duas camadas de massa (mesma variedade)
 * @param fillingLayers       exactamente duas camadas de recheio
 * @param maxDistinctFillings máximo de recheios distintos nas duas camadas
 * @param maxExtras           máximo de extras (zero a três)
 * @param moistChangesPrice   «molhado» nunca altera o preço (false)
 */
public record CakeStudioRules(
        int cakeLayers,
        int fillingLayers,
        int maxDistinctFillings,
        int maxExtras,
        boolean moistChangesPrice) {

    public static final CakeStudioRules DEFAULT =
            new CakeStudioRules(2, 2, 2, 3, false);
}
