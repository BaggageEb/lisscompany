import { describe, expect, it } from 'vitest';
import { makeOptions } from './fixtures';
import { estimateComposition, fromMinorUnits, toMinorUnits } from './pricing';
import { INITIAL_COMPOSITION } from './state';
import type { CakeComposition } from './types';

describe('toMinorUnits / fromMinorUnits', () => {
  it('converte decimais do backend em cêntimos inteiros', () => {
    expect(toMinorUnits('2500.00')).toBe(250_000);
    expect(toMinorUnits('1500.5')).toBe(150_050);
    expect(toMinorUnits('0.99')).toBe(99);
    expect(toMinorUnits('7')).toBe(700);
    // Aceita vírgula decimal (formato lusófone) sem perder precisão.
    expect(toMinorUnits('2500,50')).toBe(250_050);
  });

  it('rejeita valores não numéricos em vez de produzir NaN silencioso', () => {
    expect(() => toMinorUnits('abc')).toThrow();
    expect(() => toMinorUnits('')).toThrow();
    expect(() => toMinorUnits('1.234.5')).toThrow();
  });

  it('reverte para decimal string com duas casas', () => {
    expect(fromMinorUnits(250_000)).toBe('2500.00');
    expect(fromMinorUnits(99)).toBe('0.99');
    expect(fromMinorUnits(150_050)).toBe('1500.50');
  });
});

describe('estimateComposition', () => {
  const options = makeOptions();

  it('uma composição vazia custa apenas a base', () => {
    const estimate = estimateComposition(INITIAL_COMPOSITION, options);
    expect(estimate.total).toBe('2500.00');
    expect(estimate.lines).toHaveLength(1);
    expect(estimate.currency).toBe('AOA');
  });

  it('soma base + deltas de massa, recheios e extras sem deriva de ponto flutuante', () => {
    const composition: CakeComposition = {
      cakeBaseId: 'base-vanilla', // +300.00
      firstFillingId: 'fill-strawberry', // +500.00
      secondFillingId: 'fill-strawberry', // +500.00 (repetido conta)
      extraIds: ['extra-sprinkles', 'extra-goldleaf'], // +200.00 +1500.00
      moist: false,
    };
    const estimate = estimateComposition(composition, options);
    // 2500 + 300 + 500 + 500 + 200 + 1500 = 5500
    expect(estimate.total).toBe('5500.00');
    expect(estimate.lines.map((line) => line.label)).toEqual([
      'Bolo no Pote',
      'Baunilha',
      'Morango',
      'Morango',
      'Granulados',
      'Folha de ouro',
    ]);
  });

  it('a opção molhado nunca altera o total', () => {
    const dry = estimateComposition(
      { cakeBaseId: 'base-chocolate', firstFillingId: 'fill-chocolate', secondFillingId: 'fill-cream', extraIds: [], moist: false },
      options,
    );
    const wet = estimateComposition(
      { cakeBaseId: 'base-chocolate', firstFillingId: 'fill-chocolate', secondFillingId: 'fill-cream', extraIds: [], moist: true },
      options,
    );
    expect(wet.total).toBe(dry.total);
  });

  it('ignora deltas zero no desglose mas mantém a linha base', () => {
    const estimate = estimateComposition(
      { cakeBaseId: 'base-chocolate', firstFillingId: 'fill-chocolate', secondFillingId: 'fill-cream', extraIds: ['extra-candles'], moist: false },
      options,
    );
    expect(estimate.lines.map((line) => line.label)).toEqual(['Bolo no Pote']);
    expect(estimate.total).toBe('2500.00');
  });

  it('ignora selecções que já não existem nas opções (id desconhecido)', () => {
    const estimate = estimateComposition(
      { cakeBaseId: 'base-removed', firstFillingId: null, secondFillingId: null, extraIds: ['extra-gone'], moist: false },
      options,
    );
    expect(estimate.total).toBe('2500.00');
  });
});
