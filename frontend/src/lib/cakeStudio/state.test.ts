import { describe, expect, it } from 'vitest';
import { makeOptions } from './fixtures';
import { cakeStudioReducer, canReachStep, INITIAL_STATE } from './state';
import type { CakeStudioAction } from './state';
import type { CakeStudioState } from './state';

const options = makeOptions();

function run(actions: CakeStudioAction[], from: CakeStudioState = INITIAL_STATE): CakeStudioState {
  return actions.reduce((state, action) => cakeStudioReducer(state, action, options), from);
}

describe('cakeStudioReducer — sequência fixa', () => {
  it('avança só quando a escolha obrigatória do passo está feita', () => {
    expect(run([{ type: 'NEXT' }]).step).toBe(1); // sem massa, não avança
    const afterBase = run([{ type: 'SELECT_CAKE_BASE', id: 'base-chocolate' }, { type: 'NEXT' }]);
    expect(afterBase.step).toBe(2);
    expect(run([{ type: 'NEXT' }], afterBase).step).toBe(2); // sem recheio, não avança
  });

  it('recuar preserva todas as escolhas já feitas', () => {
    const state = run([
      { type: 'SELECT_CAKE_BASE', id: 'base-vanilla' },
      { type: 'NEXT' },
      { type: 'SELECT_FILLING', slot: 1, id: 'fill-strawberry' },
      { type: 'NEXT' },
      { type: 'GO_TO_STEP', step: 1 },
    ]);
    expect(state.step).toBe(1);
    expect(state.composition.cakeBaseId).toBe('base-vanilla');
    expect(state.composition.firstFillingId).toBe('fill-strawberry');
  });

  it('a segunda camada de massa usa a mesma variedade — sem segunda escolha possível', () => {
    const actions: CakeStudioAction[] = [
      { type: 'SELECT_CAKE_BASE', id: 'base-chocolate' },
      { type: 'NEXT' },
      { type: 'SELECT_FILLING', slot: 1, id: 'fill-cream' },
      { type: 'NEXT' }, // passo 3 (segunda camada) — sem escolha, só continuar
      { type: 'NEXT' },
    ];
    const state = run(actions);
    expect(state.step).toBe(4);
    expect(state.composition.cakeBaseId).toBe('base-chocolate');
  });

  it('permite repetir o primeiro recheio no segundo slot', () => {
    const state = run([
      { type: 'SELECT_CAKE_BASE', id: 'base-chocolate' },
      { type: 'NEXT' },
      { type: 'SELECT_FILLING', slot: 1, id: 'fill-cream' },
      { type: 'NEXT' },
      { type: 'NEXT' },
      { type: 'SELECT_FILLING', slot: 2, id: 'fill-cream' },
    ]);
    expect(state.composition.secondFillingId).toBe('fill-cream');
  });

  it('limpa o segundo recheio se violar o limite de distintos', () => {
    const strict = makeOptions({
      rules: { cakeLayers: 2, fillingLayers: 2, maxDistinctFillings: 1, maxExtras: 3, moistChangesPrice: false },
    });
    const state = [
      { type: 'SELECT_CAKE_BASE', id: 'base-chocolate' },
      { type: 'SELECT_FILLING', slot: 1, id: 'fill-cream' },
      { type: 'SELECT_FILLING', slot: 2, id: 'fill-strawberry' },
    ].reduce((s, action) => cakeStudioReducer(s, action as CakeStudioAction, strict), INITIAL_STATE);
    expect(state.composition.firstFillingId).toBe('fill-cream');
    expect(state.composition.secondFillingId).toBeNull();
  });

  it('limita os extras a três e permite desseleccionar', () => {
    const state = run([
      { type: 'TOGGLE_EXTRA', id: 'extra-sprinkles' },
      { type: 'TOGGLE_EXTRA', id: 'extra-goldleaf' },
      { type: 'TOGGLE_EXTRA', id: 'extra-message' },
      { type: 'TOGGLE_EXTRA', id: 'extra-berries' }, // quarto — ignorado
    ]);
    expect(state.composition.extraIds).toEqual(['extra-sprinkles', 'extra-goldleaf', 'extra-message']);
    const toggledOff = cakeStudioReducer(state, { type: 'TOGGLE_EXTRA', id: 'extra-goldleaf' }, options);
    expect(toggledOff.composition.extraIds).toEqual(['extra-sprinkles', 'extra-message']);
  });

  it('ignora selecções de ingredientes indisponíveis', () => {
    const state = run([
      { type: 'SELECT_FILLING', slot: 1, id: 'fill-seasonal' }, // indisponível
      { type: 'TOGGLE_EXTRA', id: 'extra-removed' }, // inexistente
    ]);
    expect(state).toBe(INITIAL_STATE);
  });

  it('GO_TO_STEP para frente exige as escolhas intermédias', () => {
    expect(run([{ type: 'GO_TO_STEP', step: 6 }]).step).toBe(1);
    const ready = run([
      { type: 'SELECT_CAKE_BASE', id: 'base-chocolate' },
      { type: 'NEXT' },
      { type: 'SELECT_FILLING', slot: 1, id: 'fill-cream' },
      { type: 'NEXT' },
      { type: 'NEXT' },
      { type: 'SELECT_FILLING', slot: 2, id: 'fill-cream' },
    ]);
    expect(ready.step).toBe(4);
    expect(canReachStep(ready, 6, options)).toBe(true);
  });

  it('RESET volta ao início sem resíduos', () => {
    const state = run([
      { type: 'SELECT_CAKE_BASE', id: 'base-vanilla' },
      { type: 'SET_MOIST', moist: true },
      { type: 'RESET' },
    ]);
    expect(state.step).toBe(1);
    expect(state.composition).toEqual({
      cakeBaseId: null,
      firstFillingId: null,
      secondFillingId: null,
      extraIds: [],
      moist: false,
    });
  });

  it('BACK nunca passa do primeiro passo', () => {
    expect(run([{ type: 'BACK' }]).step).toBe(1);
  });
});
