import { describe, expect, it } from 'vitest';
import { makeOptions } from './fixtures';
import { isCompositionComplete, validateComposition } from './validation';
import type { CakeComposition } from './types';

const options = makeOptions();

function composition(overrides: Partial<CakeComposition> = {}): CakeComposition {
  return {
    cakeBaseId: 'base-chocolate',
    firstFillingId: 'fill-chocolate',
    secondFillingId: 'fill-strawberry',
    extraIds: [],
    moist: false,
    ...overrides,
  };
}

describe('validateComposition', () => {
  it('aceita uma composição completa e válida', () => {
    expect(validateComposition(composition(), options)).toEqual([]);
    expect(isCompositionComplete(composition(), options)).toBe(true);
  });

  it('exige massa e os dois recheios', () => {
    const issues = validateComposition(
      composition({ cakeBaseId: null, firstFillingId: null, secondFillingId: null }),
      options,
    );
    expect(issues.map((issue) => issue.field)).toEqual(['cakeBase', 'firstFilling', 'secondFilling']);
    expect(isCompositionComplete(composition({ secondFillingId: null }), options)).toBe(false);
  });

  it('permite os dois recheios iguais (mesmo tipo repetido)', () => {
    const same = composition({ firstFillingId: 'fill-cream', secondFillingId: 'fill-cream' });
    expect(validateComposition(same, options)).toEqual([]);
  });

  it('rejeita ingredientes indisponíveis com mensagem específica', () => {
    const issues = validateComposition(composition({ firstFillingId: 'fill-seasonal' }), options);
    expect(issues.some((issue) => issue.field === 'firstFilling' && issue.message.includes('indisponível'))).toBe(true);
  });

  it('rejeita opções que já não existem (id desconhecido)', () => {
    const issues = validateComposition(composition({ cakeBaseId: 'base-removed' }), options);
    expect(issues.some((issue) => issue.field === 'cakeBase')).toBe(true);
  });

  it('impõe o limite de extras (máx. 3)', () => {
    const tooMany = composition({ extraIds: ['extra-sprinkles', 'extra-goldleaf', 'extra-message', 'extra-berries'] });
    const issues = validateComposition(tooMany, options);
    expect(issues.some((issue) => issue.field === 'extras' && issue.message.includes('máximo 3'))).toBe(true);
  });

  it('impõe o limite de recheios distintos quando a regra o exige', () => {
    const strict = makeOptions({
      rules: { cakeLayers: 2, fillingLayers: 2, maxDistinctFillings: 1, maxExtras: 3, moistChangesPrice: false },
    });
    const issues = validateComposition(composition(), strict);
    expect(issues.some((issue) => issue.field === 'secondFilling' && issue.message.includes('distintos'))).toBe(true);
  });
});
