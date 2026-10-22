/**
 * Cliente de API tipado.
 *
 * Toda a comunicação com o backend passa por aqui: mesmo envelope de erro,
 * timeout, e sem assumir que o backend está disponível (a UI trata estados de
 * erro de rede de forma explícita). Em desenvolvimento, o proxy do Vite
 * encaminha /api e /actuator para o Spring Boot (ver vite.config.ts).
 */

const API_TIMEOUT_MS = 8_000;

/**
 * Sinal de timeout da requisição.
 *
 * `AbortSignal.timeout` não existe em todos os ambientes (ex.: jsdom nos
 * testes não o implementa). Sem esta salvaguarda a criação do sinal lançaria
 * `TypeError` e todo o pedido seria tratado como erro de rede — por isso
 * usamos um `AbortController` com `setTimeout` como alternativa portátil.
 */
function requestTimeout(ms: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly path: string,
    readonly fieldErrors: Record<string, string> = {},
    /** Motivos de regra de domínio (ex.: carrinho rejeitado no checkout). */
    readonly issues: string[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiErrorBody {
  status?: number;
  code?: string;
  message?: string;
  path?: string;
  fieldErrors?: Record<string, string>;
  issues?: string[];
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  return apiFetchInternal<T>(path, init, false);
}

/**
 * Token CSRF da sessão. Todas as mutações fora de `/api/v1/public/**` levam o
 * cabeçalho `X-CSRF-TOKEN`; o token obtém-se uma vez em `GET /api/v1/csrf` e
 * renova-se automaticamente se o servidor rejeitar (sessão nova).
 */
let csrfToken: string | null = null;

async function ensureCsrfToken(force = false): Promise<string> {
  if (csrfToken && !force) return csrfToken;
  let response: Response;
  try {
    response = await fetch('/api/v1/csrf', {
      credentials: 'same-origin',
      signal: requestTimeout(API_TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Sem ligação ao servidor. Verifique a sua internet.', '/api/v1/csrf');
  }
  if (!response.ok) {
    throw new ApiError(response.status, 'CSRF_UNAVAILABLE', 'Não foi possível obter o token de segurança.', '/api/v1/csrf');
  }
  csrfToken = ((await response.json()) as { token: string }).token;
  return csrfToken;
}

/** Descarta o token: depois do logout a sessão (e o token) já não servem. */
export function invalidateCsrfToken(): void {
  csrfToken = null;
}

async function apiFetchInternal<T>(path: string, init: RequestInit, isRetry: boolean): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const isMutation = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  // Os POSTs públicos (orçamentos) são cálculos puros e estão isentos de CSRF.
  const needsCsrf = isMutation && !path.startsWith('/api/v1/public/');
  if (needsCsrf) {
    await ensureCsrfToken();
  }

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(needsCsrf && csrfToken ? { 'X-CSRF-TOKEN': csrfToken } : {}),
        ...init.headers,
      },
      credentials: 'same-origin',
      signal: init.signal ?? requestTimeout(API_TIMEOUT_MS),
    });
  } catch (cause) {
    // Um ApiError já lançado (ex.: pelo mock de testes ou por outro cliente)
    // re-passa intacto, para não perder o status/code originais.
    if (cause instanceof ApiError) throw cause;
    if (cause instanceof DOMException && cause.name === 'TimeoutError') {
      throw new ApiError(0, 'NETWORK_TIMEOUT', 'O servidor demorou a responder. Tente novamente.', path);
    }
    throw new ApiError(0, 'NETWORK_ERROR', 'Sem ligação ao servidor. Verifique a sua internet.', path);
  }

  if (response.ok) {
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  let body: ApiErrorBody = {};
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    // Resposta sem corpo JSON — mantém o envelope genérico.
  }

  // 403 numa mutação com CSRF: o token expirou (sessão nova). Renova uma vez.
  if (response.status === 403 && needsCsrf && !isRetry) {
    invalidateCsrfToken();
    await ensureCsrfToken(true);
    return apiFetchInternal<T>(path, init, true);
  }

  throw new ApiError(
    response.status,
    body.code ?? 'HTTP_ERROR',
    body.message ?? 'O pedido não pôde ser processado.',
    body.path ?? path,
    body.fieldErrors ?? {},
    body.issues ?? [],
  );
}

export interface HealthStatus {
  status: 'UP' | 'DOWN' | 'DEGRADED';
}

/** Verifica o estado da API (endpoint público de liveness). */
export function fetchHealth(signal?: AbortSignal): Promise<HealthStatus> {
  return apiFetch<HealthStatus>('/actuator/health', { signal });
}

/* ------------------------------------------------------------------ *
 * Catálogo e Cake Studio (fases 2–3)
 * ------------------------------------------------------------------ */

import type { CakeQuote, CakeStudioOptions } from './cakeStudio/types';

export interface ProductSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  /** Preço base em decimal string (Kz). O backend é a autoridade. */
  basePrice: string;
  currency: 'AOA';
  imageUrl?: string | null;
  categorySlug: string;
  categoryName: string;
  available: boolean;
}

/**
 * Lista os produtos activos do catálogo (público). O backend devolve a lista
 * directamente — sem envelope de sucesso, tal como nas categorias.
 */
export function fetchProducts(signal?: AbortSignal): Promise<ProductSummary[]> {
  return apiFetch<ProductSummary[]>('/api/v1/public/catalog/products', { signal });
}

/** Detalhe de um produto por slug (público). */
export function fetchProduct(slug: string, signal?: AbortSignal): Promise<ProductSummary> {
  return apiFetch<ProductSummary>(`/api/v1/public/catalog/products/${encodeURIComponent(slug)}`, { signal });
}

/** Opções do Cake Studio: produto base, regras e ingredientes disponíveis. */
export function fetchCakeStudioOptions(signal?: AbortSignal): Promise<CakeStudioOptions> {
  return apiFetch<CakeStudioOptions>('/api/v1/public/cake-studio/options', { signal });
}

/** Orçamento oficial: o backend recalcula preço e validade da composição. */
export function postCakeQuote(
  body: {
    cakeBaseId: string;
    firstFillingId: string;
    secondFillingId: string;
    extraIds: string[];
    moist: boolean;
  },
  signal?: AbortSignal,
): Promise<CakeQuote> {
  return apiFetch<CakeQuote>('/api/v1/public/cake-studio/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

/* ------------------------------------------------------------------ *
 * Carrinho (fase 4)
 * ------------------------------------------------------------------ */

export interface CartQuoteProductLine {
  productId: string;
  quantity: number;
}

export interface CartQuoteCakeLine {
  cakeBaseId: string;
  firstFillingId: string;
  secondFillingId: string;
  extraIds: string[];
  moist: boolean;
  quantity: number;
}

export interface CartQuoteLine {
  kind: 'PRODUCT' | 'CAKE';
  name: string;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
  valid: boolean;
  issues: string[];
}

export interface CartQuote {
  valid: boolean;
  total: string;
  currency: 'AOA';
  lines: CartQuoteLine[];
  issues: string[];
}

/**
 * Revalida o carrinho inteiro no servidor antes do checkout: cada linha é
 * repreçada com o preço actual do catálogo e cada bolo passa pelo orçamento
 * oficial do Cake Studio. O navegador manda apenas identificadores e
 * quantidades — nenhum preço é aceite de fora.
 */
export function postCartQuote(
  body: { productLines: CartQuoteProductLine[]; cakeLines: CartQuoteCakeLine[] },
  signal?: AbortSignal,
): Promise<CartQuote> {
  return apiFetch<CartQuote>('/api/v1/public/cart/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

/* ------------------------------------------------------------------ *
 * Identidade (fase 4) — sessão de navegador com cookies + CSRF
 * ------------------------------------------------------------------ */

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  /** Telefone dado no registo; serve para pré-preencher o checkout. */
  phone?: string | null;
  /** Conta autorizada para o painel (fase 7) — a autorização é do servidor. */
  owner?: boolean;
}

export function registerAccount(body: {
  email: string;
  displayName: string;
  password: string;
  phone?: string;
}): Promise<AuthUser> {
  return apiFetch<AuthUser>('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function login(body: { email: string; password: string }): Promise<AuthUser> {
  return apiFetch<AuthUser>('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function logout(): Promise<void> {
  return apiFetch<void>('/api/v1/auth/logout', { method: 'POST' });
}

/** Sessão actual: 401 (envelope) quando não há login — a UI trata. */
export function fetchMe(signal?: AbortSignal): Promise<AuthUser> {
  return apiFetch<AuthUser>('/api/v1/auth/me', { signal });
}

/* ------------------------------------------------------------------ *
 * Encomendas (fase 4) — autenticadas e protegidas por CSRF
 * ------------------------------------------------------------------ */

export type Fulfillment = 'PICKUP' | 'DELIVERY';
export type PaymentMethod = 'IBAN_TRANSFER' | 'MULTICAIXA_EXPRESS' | 'ON_DELIVERY';

export interface OrderItemView {
  kind: 'PRODUCT' | 'CAKE';
  name: string;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
  /** Rótulos do bolo gerados pelo servidor (snapshot). */
  summary: string[];
}

export interface OrderView {
  number: string;
  status: string;
  /** Estado do pagamento (fase 5): PENDING | PAID | FAILED… */
  paymentStatus: string | null;
  createdAt: string;
  fulfillment: Fulfillment;
  paymentMethod: PaymentMethod;
  contactName: string;
  contactPhone: string;
  notes: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  addressCity: string | null;
  addressMunicipality: string | null;
  subtotal: string;
  deliveryFee: string;
  /** Desconto de fidelização aplicado pelo servidor (fase 6) — nunca calculado aqui. */
  discountAmount: string;
  discountLabel: string | null;
  /** Pontos de fidelização gastos no resgate desta encomenda (fase 6). */
  pointsSpent: number;
  total: string;
  currency: 'AOA';
  items: OrderItemView[];
}

export interface OrderSummaryView {
  number: string;
  status: string;
  paymentStatus: string | null;
  createdAt: string;
  total: string;
  currency: 'AOA';
  itemCount: number;
}

export interface CreateOrderBody {
  contactName: string;
  contactPhone: string;
  fulfillment: Fulfillment;
  addressLine1?: string;
  addressLine2?: string;
  addressCity?: string;
  addressMunicipality?: string;
  paymentMethod: PaymentMethod;
  notes?: string;
  productLines: { productId: string; quantity: number }[];
  cakeLines: {
    cakeBaseId: string;
    firstFillingId: string;
    secondFillingId: string;
    extraIds: string[];
    moist: boolean;
    quantity: number;
  }[];
  /** Pontos de fidelização a resgatar (fase 6; o servidor valida saldo e limites). */
  pointsToSpend?: number;
  /** Código público da recompensa escolhida (fase 6; um desconto por encomenda). */
  rewardCode?: string;
}

/** Cria a encomenda: o servidor revalida o carrinho e responde 422 se algo mudou. */
export function createOrder(body: CreateOrderBody, signal?: AbortSignal): Promise<OrderView> {
  return apiFetch<OrderView>('/api/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

export function fetchOrders(signal?: AbortSignal): Promise<OrderSummaryView[]> {
  return apiFetch<OrderSummaryView[]>('/api/v1/orders', { signal });
}

export function fetchOrder(orderNumber: string, signal?: AbortSignal): Promise<OrderView> {
  return apiFetch<OrderView>(`/api/v1/orders/${encodeURIComponent(orderNumber)}`, { signal });
}

/**
 * Cancela a encomenda do próprio cliente. O servidor só aceita enquanto ela
 * ainda não foi confirmada (decisão #7); depois disso devolve 409.
 */
export function cancelOrder(orderNumber: string, signal?: AbortSignal): Promise<OrderView> {
  return apiFetch<OrderView>(`/api/v1/orders/${encodeURIComponent(orderNumber)}/cancel`, {
    method: 'POST',
    signal,
  });
}

/* ------------------------------------------------------------------ *
 * Fidelização (fase 6) — o estado do programa vem do servidor, em
 * estados honestos: não configurado, pausado, activo com elegibilidade.
 * ------------------------------------------------------------------ */

export interface LoyaltyWelcome {
  eligible: boolean;
  /** Percentagem configurada pela loja (decimal string). */
  percent: string;
  label: string;
}

export interface LoyaltyReward {
  code: string;
  description: string;
  minPoints: number | null;
  minOrders: number | null;
  discountAmount: string;
  maxPerCustomer: number;
  active: boolean;
}

export interface LoyaltyRewardStatus {
  reward: LoyaltyReward;
  eligible: boolean;
  /** Motivo de indisponibilidade (null quando elegível). */
  reason: string | null;
  redeemedCount: number;
}

export interface LoyaltySummary {
  /** O programa só existe quando a loja o configurou — nada é presumido. */
  configured: boolean;
  active: boolean;
  pointsBalance: number;
  lifetimePoints: number;
  earnPercent: string | null;
  pointValueKz: string | null;
  rounding: string | null;
  allowPartialRedemption: boolean | null;
  welcome: LoyaltyWelcome | null;
  rewards: LoyaltyRewardStatus[];
}

export interface LoyaltyTransactionView {
  type: 'EARN' | 'REDEEM' | 'ADJUSTMENT';
  points: number;
  amountKz: string;
  rateKind: 'EARN_PERCENT' | 'POINT_VALUE';
  rateUsed: string;
  orderNumber: string | null;
  note: string | null;
  createdAt: string;
}

/** Resumo de fidelização do próprio cliente (privado). */
export function fetchLoyalty(signal?: AbortSignal): Promise<LoyaltySummary> {
  return apiFetch<LoyaltySummary>('/api/v1/loyalty', { signal });
}

/** Movimentos de pontos do próprio cliente (mais recente primeiro). */
export function fetchLoyaltyTransactions(signal?: AbortSignal): Promise<LoyaltyTransactionView[]> {
  return apiFetch<LoyaltyTransactionView[]>('/api/v1/loyalty/transactions', { signal });
}

/* ------------------------------------------------------------------ *
 * Área do cliente (fase 7) — perfil, palavra-passe e moradas
 * ------------------------------------------------------------------ */

export interface ProfileView {
  id: string;
  email: string;
  displayName: string;
  phone: string | null;
}

export interface AddressView {
  id: string;
  label: string | null;
  recipientName: string | null;
  line1: string;
  line2: string | null;
  city: string;
  municipality: string | null;
  province: string | null;
  phone: string | null;
  isDefault: boolean;
}

export interface AddressBody {
  label?: string;
  recipientName?: string;
  line1: string;
  line2?: string;
  city: string;
  municipality?: string;
  province?: string;
  phone?: string;
  isDefault?: boolean;
}

export function fetchProfile(signal?: AbortSignal): Promise<ProfileView> {
  return apiFetch<ProfileView>('/api/v1/account/profile', { signal });
}

export function updateProfile(body: { displayName: string; phone?: string }): Promise<ProfileView> {
  return apiFetch<ProfileView>('/api/v1/account/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Altera a palavra-passe: o servidor exige a actual (campo em 400). */
export function changePassword(body: { currentPassword: string; newPassword: string }): Promise<void> {
  return apiFetch<void>('/api/v1/account/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function fetchAddresses(signal?: AbortSignal): Promise<AddressView[]> {
  return apiFetch<AddressView[]>('/api/v1/account/addresses', { signal });
}

export function createAddress(body: AddressBody): Promise<AddressView> {
  return apiFetch<AddressView>('/api/v1/account/addresses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function updateAddress(id: string, body: AddressBody): Promise<AddressView> {
  return apiFetch<AddressView>(`/api/v1/account/addresses/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function deleteAddress(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/account/addresses/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Sessão activa da conta: handle opaco (nunca o id real da sessão). */
export interface SessionView {
  handle: string;
  createdAt: string;
  /** true = a sessão que está a ver esta página. */
  current: boolean;
}

export function fetchSessions(signal?: AbortSignal): Promise<SessionView[]> {
  return apiFetch<SessionView[]>('/api/v1/auth/sessions', { signal });
}

/** Termina uma sessão desta conta (404 se já não existir). */
export function revokeSession(handle: string): Promise<void> {
  return apiFetch<void>(`/api/v1/auth/sessions/${encodeURIComponent(handle)}/revoke`, {
    method: 'POST',
  });
}

/* ------------------------------------------------------------------ *
 * Painel administrativo (fase 7) — tudo exige conta autorizada (403)
 * ------------------------------------------------------------------ */

export interface AdminOrderSummary {
  number: string;
  status: string;
  paymentStatus: string | null;
  createdAt: string;
  total: string;
  currency: 'AOA';
  itemCount: number;
  contactName: string;
  fulfillment: Fulfillment;
  paymentMethod: PaymentMethod;
}

export interface AdminOrderDetail {
  order: OrderView;
  /** Transições que a máquina de estados aceita (o servidor revalida). */
  allowedTargets: string[];
}

export interface PaymentAdminView {
  orderNumber: string;
  orderStatus: string;
  contactName: string;
  method: PaymentMethod;
  amount: string;
  currency: 'AOA';
  status: string;
  createdAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export interface StockView {
  productId: string;
  productName: string;
  availableQty: number;
  reservedQty: number;
  unitLabel: string;
}

export interface LoyaltyAdminRuleView {
  earnPercent: string;
  pointValueKz: string;
  rounding: string;
  allowPartialRedemption: boolean;
  active: boolean;
  updatedAt: string;
}

export interface LoyaltyAdminRewardView {
  code: string;
  description: string;
  minPoints: number | null;
  minOrders: number | null;
  discountAmount: string;
  maxPerCustomer: number;
  active: boolean;
}

export interface LoyaltyAdminConfig {
  rule: LoyaltyAdminRuleView | null;
  rewards: LoyaltyAdminRewardView[];
}

export interface LoyaltyAdminRuleBody {
  earnPercent: string;
  pointValueKz: string;
  rounding: string;
  allowPartialRedemption: boolean;
  active: boolean;
}

export interface LoyaltyAdminRewardBody {
  code: string;
  description: string;
  minPoints?: number;
  minOrders?: number;
  discountAmount: string;
  maxPerCustomer: number;
  active: boolean;
}

export interface DiscountRuleView {
  code: string;
  description: string;
  kind: 'WELCOME' | 'REWARD';
  percent: string | null;
  amount: string | null;
  rewardCode: string | null;
  priority: number;
  active: boolean;
}

export interface DiscountRuleBody {
  code: string;
  description: string;
  kind: 'WELCOME' | 'REWARD';
  percent?: string;
  amount?: string;
  rewardCode?: string;
  priority: number;
  active: boolean;
}

export interface LoyaltyAdminAccountView {
  userId: string;
  email: string;
  displayName: string;
  pointsBalance: number;
  lifetimePoints: number;
  updatedAt: string;
}

function withQuery(path: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

export function fetchAdminOrders(
  params: { status?: string; paymentStatus?: string } = {},
  signal?: AbortSignal,
): Promise<AdminOrderSummary[]> {
  return apiFetch<AdminOrderSummary[]>(withQuery('/api/v1/admin/orders', params), { signal });
}

export function fetchAdminOrderDetail(number: string, signal?: AbortSignal): Promise<AdminOrderDetail> {
  return apiFetch<AdminOrderDetail>(`/api/v1/admin/orders/${encodeURIComponent(number)}`, { signal });
}

export function transitionAdminOrder(number: string, target: string, note?: string): Promise<OrderView> {
  return apiFetch<OrderView>(`/api/v1/admin/orders/${encodeURIComponent(number)}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target, note: note?.trim() || undefined }),
  });
}

export function fetchAdminPayments(status?: string, signal?: AbortSignal): Promise<PaymentAdminView[]> {
  return apiFetch<PaymentAdminView[]>(withQuery('/api/v1/admin/payments', { status }), { signal });
}

/** Revisão manual do pagamento (decisão #5): PAID ou FAILED, idempotente. */
export function reviewPayment(
  orderNumber: string,
  body: { target: 'PAID' | 'FAILED'; note?: string; idempotencyKey?: string },
): Promise<PaymentServiceView> {
  return apiFetch<PaymentServiceView>(
    `/api/v1/admin/payments/${encodeURIComponent(orderNumber)}/review`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

export interface PaymentServiceView {
  orderNumber: string;
  method: PaymentMethod;
  amount: string;
  currency: 'AOA';
  status: string;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export function fetchAdminStock(signal?: AbortSignal): Promise<StockView[]> {
  return apiFetch<StockView[]>('/api/v1/admin/inventory', { signal });
}

/** Ajuste manual (decisão #2): a primeira entrada positiva cria a linha. */
export function adjustStock(productId: string, body: { delta: number; note?: string }): Promise<StockView> {
  return apiFetch<StockView>(`/api/v1/admin/inventory/${encodeURIComponent(productId)}/adjustment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function fetchAdminLoyaltyConfig(signal?: AbortSignal): Promise<LoyaltyAdminConfig> {
  return apiFetch<LoyaltyAdminConfig>('/api/v1/admin/loyalty/config', { signal });
}

export function saveAdminLoyaltyRule(body: LoyaltyAdminRuleBody): Promise<LoyaltyAdminRuleView> {
  return apiFetch<LoyaltyAdminRuleView>('/api/v1/admin/loyalty/config/rule', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function upsertAdminReward(body: LoyaltyAdminRewardBody): Promise<LoyaltyAdminRewardView> {
  return apiFetch<LoyaltyAdminRewardView>('/api/v1/admin/loyalty/config/rewards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function fetchAdminDiscounts(signal?: AbortSignal): Promise<DiscountRuleView[]> {
  return apiFetch<DiscountRuleView[]>('/api/v1/admin/loyalty/config/discounts', { signal });
}

export function upsertAdminDiscount(body: DiscountRuleBody): Promise<DiscountRuleView> {
  return apiFetch<DiscountRuleView>('/api/v1/admin/loyalty/config/discounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function fetchAdminLoyaltyAccounts(signal?: AbortSignal): Promise<LoyaltyAdminAccountView[]> {
  return apiFetch<LoyaltyAdminAccountView[]>('/api/v1/admin/loyalty/accounts', { signal });
}

export function adjustLoyaltyPoints(
  userId: string,
  body: { points: number; note?: string },
): Promise<LoyaltyTransactionView> {
  return apiFetch<LoyaltyTransactionView>(
    `/api/v1/admin/loyalty/accounts/${encodeURIComponent(userId)}/adjustment`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}
