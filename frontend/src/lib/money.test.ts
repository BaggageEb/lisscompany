import { describe, expect, it } from 'vitest';
import { formatKz } from './money';

describe('formatKz', () => {
  it('formata valores decimais em Kz com separadores em português', () => {
    const result = formatKz('2500.5');
    expect(result).toMatch(/Kz$/);
    expect(result).toContain('2');
    expect(result).toContain('50');
    // Usa vírgula decimal (convenção lusófona) e não ponto.
    expect(result).toMatch(/,\d{2}\s*Kz$/);
  });

  it('aceita string decimal vinda do backend sem perder precisão', () => {
    expect(formatKz('10000.00')).toMatch(/10\s?000,\d{2}\s*Kz|10\.000,\d{2}\s*Kz/);
  });

  it('devolve traço para valores inválidos em vez de NaN', () => {
    expect(formatKz('abc')).toBe('—');
    expect(formatKz(Number.NaN)).toBe('—');
  });
});
