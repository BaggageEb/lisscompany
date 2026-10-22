/**
 * Contrato de domínio do LissCompany Cake Studio.
 *
 * Estes tipos espelham o contrato da API pública (`/api/v1/cake-studio/*`)
 * definido no backend. O backend é sempre autoritativo: aqui vive apenas o
 * estado de composição do utilizador e uma estimativa de preço imediata para
 * feedback visual; o total definitivo e a validação da composição são sempre
 * confirmados pelo servidor antes de a criação entrar no carrinho.
 */

export type IngredientKind = 'CAKE_BASE' | 'FILLING' | 'EXTRA';

export interface IngredientOption {
  id: string;
  slug: string;
  name: string;
  description: string;
  /** Delta de preço sobre a base, em decimal string (Kz). "0.00" quando não acrescenta. */
  priceDelta: string;
  imageUrl?: string | null;
  available: boolean;
  displayOrder: number;
}

/** Regras fixas do configurador, servidas pelo backend para o cliente exibir. */
export interface CakeStudioRules {
  cakeLayers: number;
  fillingLayers: number;
  maxDistinctFillings: number;
  maxExtras: number;
  moistChangesPrice: boolean;
}

export interface CakeStudioBaseProduct {
  id: string;
  slug: string;
  name: string;
  /** Preço base do produto, em decimal string (Kz). */
  basePrice: string;
  currency: 'AOA';
  description?: string | null;
}

export interface CakeStudioOptions {
  baseProduct: CakeStudioBaseProduct;
  rules: CakeStudioRules;
  cakeBases: IngredientOption[];
  fillings: IngredientOption[];
  extras: IngredientOption[];
}

/** Sequência fixa de passos do Studio (1→6). */
export type CakeStudioStep = 1 | 2 | 3 | 4 | 5 | 6;

export interface CakeComposition {
  cakeBaseId: string | null;
  firstFillingId: string | null;
  secondFillingId: string | null;
  extraIds: string[];
  moist: boolean;
}

/** Linha do desglose de preço devolvido pelo servidor (ou estimado no cliente). */
export interface QuoteLine {
  label: string;
  amount: string;
}

export interface CakeQuote {
  valid: boolean;
  total: string;
  currency: 'AOA';
  lines: QuoteLine[];
  issues: string[];
}
