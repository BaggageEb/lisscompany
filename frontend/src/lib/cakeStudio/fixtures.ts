/**
 * Fixtures de teste para o Cake Studio.
 *
 * Espelham o contrato real da API de produção para que os testes de domínio
 * rodem sem rede e sem backend. Não é importado pela aplicação (só pelos
 * testes), pelo que não entra no bundle de produção.
 */
import type { CakeStudioOptions, IngredientOption } from './types';

function option(
  id: string,
  name: string,
  priceDelta: string,
  overrides: Partial<IngredientOption> = {},
): IngredientOption {
  return {
    id,
    slug: id,
    name,
    description: `${name} — descrição de teste`,
    priceDelta,
    available: true,
    displayOrder: 1,
    ...overrides,
  };
}

export function makeOptions(overrides: Partial<CakeStudioOptions> = {}): CakeStudioOptions {
  return {
    baseProduct: {
      id: 'product-bolo-no-pote',
      slug: 'bolo-no-pote',
      name: 'Bolo no Pote',
      basePrice: '2500.00',
      currency: 'AOA',
    },
    rules: {
      cakeLayers: 2,
      fillingLayers: 2,
      maxDistinctFillings: 2,
      maxExtras: 3,
      moistChangesPrice: false,
    },
    cakeBases: [
      option('base-chocolate', 'Chocolate', '0.00'),
      option('base-vanilla', 'Baunilha', '300.00'),
    ],
    fillings: [
      option('fill-chocolate', 'Ganache de chocolate', '0.00'),
      option('fill-strawberry', 'Morango', '500.00'),
      option('fill-cream', 'Creme de leite', '0.00'),
      option('fill-seasonal', 'Fruta da época', '800.00', { available: false }),
    ],
    extras: [
      option('extra-sprinkles', 'Granulados', '200.00'),
      option('extra-goldleaf', 'Folha de ouro', '1500.00'),
      option('extra-message', 'Mensagem personalizada', '400.00'),
      option('extra-berries', 'Frutos vermelhos', '900.00'),
      option('extra-candles', 'Velas', '0.00'),
    ],
    ...overrides,
  };
}
