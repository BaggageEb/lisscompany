import { describe, expect, it } from 'vitest';
import { makeOptions } from './fixtures';
import { estimateComposition } from './pricing';
import { cakeStudioReducer, INITIAL_STATE } from './state';
import type { CakeStudioAction, CakeStudioState } from './state';
import { validateComposition } from './validation';
import { addonChoices } from '../cart';

const options = makeOptions({
  addons: [
    { id: 'addon-candles', slug: 'velas', name: 'Velas', description: '', priceDelta: '0.00', available: true, displayOrder: 1 },
    { id: 'addon-card', slug: 'cartao', name: 'Cartão', description: '', priceDelta: '500.00', available: true, displayOrder: 2, allowsMessage: true },
    { id: 'addon-off', slug: 'fogo', name: 'Fogo de artifício', description: '', priceDelta: '900.00', available: false, displayOrder: 3 },
  ],
});

function run(actions: CakeStudioAction[], from: CakeStudioState = INITIAL_STATE): CakeStudioState {
  return actions.reduce((state, action) => cakeStudioReducer(state, action, options), from);
}

describe('Complementos do Cake Studio (independentes dos três extras)', () => {
  it('não ocupam vagas dos extras: 3 extras + complementos é válido', () => {
    const state = run([
      { type: 'SELECT_CAKE_BASE', id: 'base-chocolate' },
      { type: 'SELECT_FILLING', slot: 1, id: 'fill-chocolate' },
      { type: 'SELECT_FILLING', slot: 2, id: 'fill-cream' },
      { type: 'TOGGLE_EXTRA', id: 'extra-sprinkles' },
      { type: 'TOGGLE_EXTRA', id: 'extra-goldleaf' },
      { type: 'TOGGLE_EXTRA', id: 'extra-berries' },
      { type: 'TOGGLE_ADDON', id: 'addon-candles' },
      { type: 'TOGGLE_ADDON', id: 'addon-card' },
    ]);
    expect(state.composition.extraIds).toHaveLength(3);
    expect(state.composition.addonIds).toEqual(['addon-candles', 'addon-card']);
    expect(validateComposition(state.composition, options)).toEqual([]);
  });

  it('o preço dos complementos entra no total estimado', () => {
    const base = run([
      { type: 'SELECT_CAKE_BASE', id: 'base-chocolate' },
      { type: 'SELECT_FILLING', slot: 1, id: 'fill-chocolate' },
      { type: 'SELECT_FILLING', slot: 2, id: 'fill-cream' },
    ]);
    const withCard = run([{ type: 'TOGGLE_ADDON', id: 'addon-card' }], base);
    expect(estimateComposition(withCard.composition, options).total).toBe('3000.00'); // 2500 + 500
  });

  it('a mensagem só existe em complementos que a admitem e desaparece ao retirá-lo', () => {
    let state = run([
      { type: 'TOGGLE_ADDON', id: 'addon-card' },
      { type: 'TOGGLE_ADDON', id: 'addon-candles' },
      { type: 'SET_ADDON_MESSAGE', id: 'addon-card', message: '  Parabéns, Mãe!  ' },
      { type: 'SET_ADDON_MESSAGE', id: 'addon-candles', message: 'ignorada' },
    ]);
    expect(state.composition.addonMessages).toEqual({ 'addon-card': '  Parabéns, Mãe!  ' });
    // O pedido ao servidor leva a mensagem aparada, só quando foi escrita.
    expect(addonChoices(state.composition)).toEqual([{ id: 'addon-card', message: 'Parabéns, Mãe!' }, { id: 'addon-candles' }]);
    state = run([{ type: 'TOGGLE_ADDON', id: 'addon-card' }], state);
    expect(state.composition.addonIds).toEqual(['addon-candles']);
    expect(state.composition.addonMessages).toEqual({});
  });

  it('não aceita complementos indisponíveis', () => {
    expect(run([{ type: 'TOGGLE_ADDON', id: 'addon-off' }]).composition.addonIds).toEqual([]);
  });
});
