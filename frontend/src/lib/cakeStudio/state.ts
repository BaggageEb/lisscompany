/**
 * Máquina de estados do LissCompany Cake Studio.
 *
 * Sequência fixa e imutável:
 *   1 massa → 2 recheio → 3 segunda camada de massa → 4 segundo recheio
 *   → 5 extras + humidade → 6 revisão
 *
 * Regras aplicadas na transição (e repetidas no backend):
 *   - exactamente duas camadas de massa, da MESMA variedade;
 *   - exactamente duas camadas de recheio, até dois tipos distintos;
 *   - zero a três extras; «molhado» não altera o preço;
 *   - recuar preserva as escolhas; avançar exige as escolhas obrigatórias.
 */
import type { CakeComposition, CakeStudioOptions, CakeStudioStep } from './types';
import { findOption } from './pricing';
import { distinctFillingCount } from './validation';

export interface CakeStudioState {
  step: CakeStudioStep;
  composition: CakeComposition;
}

export const INITIAL_COMPOSITION: CakeComposition = Object.freeze({
  cakeBaseId: null,
  firstFillingId: null,
  secondFillingId: null,
  extraIds: [] as string[],
  moist: false,
});

export const INITIAL_STATE: CakeStudioState = {
  step: 1,
  composition: INITIAL_COMPOSITION,
};

export type CakeStudioAction =
  | { type: 'SELECT_CAKE_BASE'; id: string }
  | { type: 'SELECT_FILLING'; slot: 1 | 2; id: string }
  | { type: 'TOGGLE_EXTRA'; id: string }
  | { type: 'SET_MOIST'; moist: boolean }
  | { type: 'GO_TO_STEP'; step: CakeStudioStep }
  | { type: 'NEXT' }
  | { type: 'BACK' }
  | { type: 'RESET' };

/** Todos os passos anteriores estão satisfeitos? (usa a mesma regra do servidor) */
export function canReachStep(state: CakeStudioState, target: CakeStudioStep, options: CakeStudioOptions): boolean {
  const c = state.composition;
  switch (target) {
    case 1:
      return true;
    case 2:
      return Boolean(c.cakeBaseId && findOption(options, 'CAKE_BASE', c.cakeBaseId)?.available);
    case 3:
      return canReachStep(state, 2, options) && Boolean(c.firstFillingId);
    case 4:
      return canReachStep(state, 3, options);
    case 5:
      return canReachStep(state, 4, options) && Boolean(c.secondFillingId);
    case 6:
      return canReachStep(state, 5, options);
  }
}

export function cakeStudioReducer(
  state: CakeStudioState,
  action: CakeStudioAction,
  options: CakeStudioOptions,
): CakeStudioState {
  switch (action.type) {
    case 'SELECT_CAKE_BASE': {
      const option = findOption(options, 'CAKE_BASE', action.id);
      if (!option || !option.available) return state;
      // A massa escolhida vale para as duas camadas; nunca há segunda variedade.
      return { ...state, composition: { ...state.composition, cakeBaseId: option.id } };
    }

    case 'SELECT_FILLING': {
      const option = findOption(options, 'FILLING', action.id);
      if (!option || !option.available) return state;
      const composition =
        action.slot === 1
          ? { ...state.composition, firstFillingId: option.id }
          : { ...state.composition, secondFillingId: option.id };
      // Defesa: se a regra de recheios distintos ficasse violada, o segundo
      // recheio é limpo em vez de deixar o cliente num estado inválido.
      if (distinctFillingCount(composition) > options.rules.maxDistinctFillings) {
        composition.secondFillingId = null;
      }
      return { ...state, composition };
    }

    case 'TOGGLE_EXTRA': {
      const option = findOption(options, 'EXTRA', action.id);
      if (!option || !option.available) return state;
      const selected = state.composition.extraIds.includes(option.id);
      if (!selected && state.composition.extraIds.length >= options.rules.maxExtras) return state;
      const extraIds = selected
        ? state.composition.extraIds.filter((id) => id !== option.id)
        : [...state.composition.extraIds, option.id];
      return { ...state, composition: { ...state.composition, extraIds } };
    }

    case 'SET_MOIST':
      return { ...state, composition: { ...state.composition, moist: action.moist } };

    case 'GO_TO_STEP':
      if (!canReachStep(state, action.step, options)) return state;
      return { ...state, step: action.step };

    case 'NEXT': {
      const next = (state.step + 1) as CakeStudioStep;
      if (state.step >= 6 || !canReachStep(state, next, options)) return state;
      return { ...state, step: next };
    }

    case 'BACK': {
      const previous = (state.step - 1) as CakeStudioStep;
      if (state.step <= 1) return state;
      return { ...state, step: previous };
    }

    case 'RESET':
      return INITIAL_STATE;
  }
}
