/**
 * Estimativa de preço no cliente para o Cake Studio.
 *
 * O backend é a única autoridade de preços. Esta estimativa existe só para
 * feedback imediato enquanto o cliente monta o bolo; o total definitivo é
 * recalculado pelo servidor (`POST /api/v1/cake-studio/quote`) antes de a
 * composição entrar no carrinho e outra vez no checkout.
 *
 * Aritmética sempre em unidades mínimas (cêntimos) — nunca ponto flutuante.
 */
import type { CakeComposition, CakeStudioOptions, IngredientKind, IngredientOption, QuoteLine } from './types';

/** Converte um decimal string do backend ("1500.50") em cêntimos inteiros. */
export function toMinorUnits(decimal: string): number {
  const match = /^(-?)(\d+)(?:[.,](\d{1,2}))?$/.exec(decimal.trim());
  if (!match) {
    throw new Error(`Valor decimal inválido: "${decimal}"`);
  }
  const [, sign, intPart, fracPart = ''] = match;
  const frac = `${fracPart}00`.slice(0, 2);
  const units = Number(intPart) * 100 + Number(frac);
  return sign === '-' ? -units : units;
}

/** Converte cêntimos inteiros em decimal string ("1500.50"). */
export function fromMinorUnits(units: number): string {
  const sign = units < 0 ? '-' : '';
  const abs = Math.abs(units);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Procura uma opção por id dentro do grupo correcto. */
export function findOption(
  options: CakeStudioOptions,
  kind: IngredientKind,
  id: string | null,
): IngredientOption | null {
  if (!id) return null;
  const group = kind === 'CAKE_BASE' ? options.cakeBases : kind === 'FILLING' ? options.fillings : options.extras;
  return group.find((option) => option.id === id) ?? null;
}

export interface CakeEstimate {
  lines: QuoteLine[];
  total: string;
  currency: 'AOA';
}

/**
 * Estima o preço da composição a partir dos deltas servidos pelo backend.
 * Apenas linhas com valor acrescentado aparecem no desglose; a opção
 * «molhado» não tem preço e por isso nunca influencia o total.
 */
export function estimateComposition(composition: CakeComposition, options: CakeStudioOptions): CakeEstimate {
  const lines: QuoteLine[] = [];
  let total = toMinorUnits(options.baseProduct.basePrice);
  lines.push({ label: options.baseProduct.name, amount: fromMinorUnits(total) });

  const selections: Array<{ kind: IngredientKind; id: string | null }> = [
    { kind: 'CAKE_BASE', id: composition.cakeBaseId },
    { kind: 'FILLING', id: composition.firstFillingId },
    { kind: 'FILLING', id: composition.secondFillingId },
    ...composition.extraIds.map((id) => ({ kind: 'EXTRA' as const, id })),
  ];

  for (const { kind, id } of selections) {
    const option = findOption(options, kind, id);
    if (!option) continue;
    const delta = toMinorUnits(option.priceDelta);
    if (delta === 0) continue;
    total += delta;
    lines.push({ label: option.name, amount: fromMinorUnits(delta) });
  }

  return { lines, total: fromMinorUnits(total), currency: 'AOA' };
}
