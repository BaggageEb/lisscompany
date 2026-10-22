/**
 * Validação da composição do Cake Studio no cliente.
 *
 * Orienta o utilizador em tempo real, mas não substitui a validação do
 * backend: a mesma regra é aplicada de novo no servidor antes de a criação
 * entrar no carrinho (não confiar nunca no cliente).
 */
import type { CakeComposition, CakeStudioOptions } from './types';
import { findOption } from './pricing';

export interface CompositionIssue {
  field: 'cakeBase' | 'firstFilling' | 'secondFilling' | 'extras';
  message: string;
}

export function distinctFillingCount(composition: CakeComposition): number {
  return new Set([composition.firstFillingId, composition.secondFillingId].filter(Boolean)).size;
}

/** Problemas que impediriam o servidor de aceitar esta composição. */
export function validateComposition(composition: CakeComposition, options: CakeStudioOptions): CompositionIssue[] {
  const issues: CompositionIssue[] = [];

  const base = findOption(options, 'CAKE_BASE', composition.cakeBaseId);
  if (!composition.cakeBaseId) {
    issues.push({ field: 'cakeBase', message: 'Escolha a massa do bolo.' });
  } else if (!base) {
    issues.push({ field: 'cakeBase', message: 'A massa escolhida já não está disponível.' });
  } else if (!base.available) {
    issues.push({ field: 'cakeBase', message: `A massa «${base.name}» está temporariamente indisponível.` });
  }

  for (const [field, id, label] of [
    ['firstFilling', composition.firstFillingId, 'primeiro'],
    ['secondFilling', composition.secondFillingId, 'segundo'],
  ] as const) {
    const filling = findOption(options, 'FILLING', id);
    if (!id) {
      issues.push({
        field,
        message: `Escolha o ${label} recheio.`,
      });
    } else if (!filling || !filling.available) {
      issues.push({ field, message: `O ${label} recheio escolhido está indisponível.` });
    }
  }

  if (distinctFillingCount(composition) > options.rules.maxDistinctFillings) {
    issues.push({
      field: 'secondFilling',
      message: `São permitidos no máximo ${options.rules.maxDistinctFillings} recheios distintos.`,
    });
  }

  if (composition.extraIds.length > options.rules.maxExtras) {
    issues.push({
      field: 'extras',
      message: `São permitidos no máximo ${options.rules.maxExtras} extras.`,
    });
  }
  for (const id of composition.extraIds) {
    const extra = findOption(options, 'EXTRA', id);
    if (!extra || !extra.available) {
      issues.push({ field: 'extras', message: 'Um dos extras escolhidos já não está disponível.' });
    }
  }

  return issues;
}

/** A composição tem todas as escolhas obrigatórias e é aceitável pelo servidor? */
export function isCompositionComplete(composition: CakeComposition, options: CakeStudioOptions): boolean {
  return validateComposition(composition, options).length === 0;
}
