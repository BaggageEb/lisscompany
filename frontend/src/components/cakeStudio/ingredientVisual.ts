/**
 * Aparência de cada ingrediente na pré-visualização do copo.
 *
 * Honestidade: isto é ILUSTRAÇÃO vectorial (cor/textura), não fotografia nem
 * render fotorrealista. As cores aproximam-se do ingrediente real; quando a
 * proprietária fornecer fotografias, passam a exibir-se nos cartões de opção
 * (`imageUrl`) sem alterar esta camada de visualização do copo.
 */
import type { IngredientKind, IngredientOption } from '../../lib/cakeStudio/types';

export interface IngredientVisual {
  /** Cor de base da camada. */
  fill: string;
  /** Cor de realce/textura. */
  accent: string;
  texture: 'crumb' | 'smooth';
}

const BY_SLUG: Record<string, IngredientVisual> = {
  // Massas
  chocolate: { fill: '#5a3826', accent: '#3f2718', texture: 'crumb' },
  baunilha: { fill: '#f0dfb4', accent: '#d9c186', texture: 'crumb' },
  'red-velvet': { fill: '#93343c', accent: '#6f252c', texture: 'crumb' },
  // Recheios
  'ganache-chocolate': { fill: '#3d2417', accent: '#59371f', texture: 'smooth' },
  'creme-de-leite': { fill: '#fdf6e8', accent: '#efe0c6', texture: 'smooth' },
  morango: { fill: '#e2687a', accent: '#c74e62', texture: 'smooth' },
  maracuja: { fill: '#f2a93b', accent: '#d98d1f', texture: 'smooth' },
  // Extras
  granulados: { fill: '#6b4a2f', accent: '#8a6543', texture: 'crumb' },
  'folha-de-ouro': { fill: '#d4af37', accent: '#b8952a', texture: 'smooth' },
  mensagem: { fill: '#fffdf8', accent: '#e6cf86', texture: 'smooth' },
  'frutos-vermelhos': { fill: '#b33a56', accent: '#8e2340', texture: 'smooth' },
  velas: { fill: '#d9c7f2', accent: '#b9a1e0', texture: 'smooth' },
};

const BY_KIND: Record<IngredientKind, IngredientVisual> = {
  CAKE_BASE: { fill: '#d9b98c', accent: '#c2a173', texture: 'crumb' },
  FILLING: { fill: '#f0e4cf', accent: '#dccbae', texture: 'smooth' },
  EXTRA: { fill: '#d4af37', accent: '#b8952a', texture: 'smooth' },
};

/** Aparência da camada para um ingrediente (ou fallback por tipo). */
export function visualFor(option: IngredientOption | null, kind: IngredientKind): IngredientVisual {
  if (!option) {
    return BY_KIND[kind];
  }
  return BY_SLUG[option.slug] ?? BY_KIND[kind];
}
