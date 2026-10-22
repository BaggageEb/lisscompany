/**
 * Formatação monetária em Kwanza angolano (AOA).
 *
 * O domínio monetário usa sempre valores decimais (string/BigDecimal no
 * backend); o frontend apenas apresenta. Nenhum cálculo de preço é feito aqui:
 * os preços são calculados e validados exclusivamente pelo backend.
 */

const KZ_GROUPING = new Intl.NumberFormat('pt-AO', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Formata um valor em Kz. Aceita string (decimal do backend) ou number
 * apenas para valores já validados — strings são o caminho preferido para
 * evitar imprecisão de ponto flutuante.
 */
export function formatKz(value: string | number): string {
  const amount = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (!Number.isFinite(amount)) {
    return '—';
  }
  return `${KZ_GROUPING.format(amount)} Kz`;
}
