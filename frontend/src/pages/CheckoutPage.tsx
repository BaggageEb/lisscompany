import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSyncExternalStore } from 'react';
import {
  ApiError,
  createOrder,
  fetchLoyalty,
  fetchStoreInfo,
  type StoreInfo,
  postCartQuote,
  type CartQuote,
  type Fulfillment,
  type LoyaltySummary,
  type OrderView,
  type PaymentMethod,
} from '../lib/api';
import { buildQuoteRequest, cartQuantity, cartTotal, clearCart, getCart, subscribeCart } from '../lib/cart';
import { formatKz } from '../lib/money';
import { useSession } from '../lib/session';
import { Badge } from '../components/ui/Badge';
import { Button, ButtonLink } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { PaymentInstructionsCard } from '../components/payment/PaymentInstructionsCard';
import './checkout.css';
import './loyalty.css';

const PAYMENT_LABELS: Record<PaymentMethod, { name: string; description: string }> = {
  ON_DELIVERY: {
    name: 'Pagamento na entrega ou levantamento',
    description: 'Paga em dinheiro ou por Multicaixa no momento da entrega ou do levantamento.',
  },
  IBAN_TRANSFER: {
    name: 'Transferência IBAN',
    description: 'Transfere para o IBAN da loja; a loja confirma o pagamento antes de preparar.',
  },
  MULTICAIXA_EXPRESS: {
    name: 'Multicaixa Express',
    description: 'Paga por Multicaixa Express; a loja confirma o pagamento antes de preparar.',
  },
};

const FULFILLMENT_LABELS: Record<Fulfillment, string> = {
  PICKUP: 'Levantamento na loja',
  DELIVERY: 'Entrega ao domicílio',
};

interface SubmitError {
  message: string;
  fieldErrors: Record<string, string>;
  issues: string[];
  cartRejected: boolean;
}

function toSubmitError(caught: unknown): SubmitError {
  if (caught instanceof ApiError) {
    return {
      message: caught.message,
      fieldErrors: caught.fieldErrors,
      issues: caught.issues,
      cartRejected: caught.status === 422,
    };
  }
  return {
    message: 'Não foi possível registar a encomenda. Tente novamente.',
    fieldErrors: {},
    issues: [],
    cartRejected: false,
  };
}

/**
 * Checkout (fase 4). Exige conta de cliente; o cliente escolhe entrega ou
 * levantamento e o método de pagamento, e o servidor — nunca o navegador —
 * revalida e confirma o carrinho no momento exacto da criação da encomenda.
 */
export function CheckoutPage() {
  const session = useSession();
  const cart = useSyncExternalStore(subscribeCart, getCart, getCart);
  const navigate = useNavigate();

  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [quoteFailed, setQuoteFailed] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [fulfillment, setFulfillment] = useState<Fulfillment>('PICKUP');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [addressCity, setAddressCity] = useState('');
  const [addressMunicipality, setAddressMunicipality] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<SubmitError | null>(null);
  const [created, setCreated] = useState<OrderView | null>(null);

  // Configuração da loja (entrega, levantamento, métodos, termos). Falhar aqui
  // nunca bloqueia o checkout: sem informação, mantém o comportamento base.
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [zoneId, setZoneId] = useState('');
  const [pickupSlot, setPickupSlot] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Fidelização (fase 6): o resumo vem do servidor, com estados honestos.
  // Uma falha aqui nunca bloqueia o checkout — a página própria explica erros.
  const [loyalty, setLoyalty] = useState<LoyaltySummary | null>(null);
  const [usePoints, setUsePoints] = useState(false);
  const [pointsInput, setPointsInput] = useState('');
  const [selectedRewardCode, setSelectedRewardCode] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchStoreInfo(controller.signal)
      .then(setStore)
      .catch(() => {
        // Sem configuração disponível: checkout base.
      });
    return () => controller.abort();
  }, []);

  // Pré-preenche contacto do perfil assim que a sessão é conhecida.
  useEffect(() => {
    if (session.kind !== 'authenticated') return;
    setContactName((current) => current || session.user.displayName);
    setContactPhone((current) => current || session.user.phone || '');
  }, [session]);

  // Identifica a zona: se o município/cidade escritos coincidem com uma zona, ou
  // só existe uma zona com preço, escolhe-a (o cliente pode sempre mudar).
  useEffect(() => {
    if (fulfillment !== 'DELIVERY' || zoneId) return;
    const priced = (store?.deliveryZones ?? []).filter((zone) => zone.priced !== false && zone.fee !== null);
    if (priced.length === 0 || (store?.delivery?.mode && store.delivery.mode !== 'ZONES')) return;
    const normalise = (value: string) =>
      value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    const typed = [addressMunicipality, addressCity].map(normalise).filter(Boolean);
    const match = priced.find((zone) => typed.includes(normalise(zone.name)));
    if (match) setZoneId(match.id);
    else if (priced.length === 1) setZoneId(priced[0].id);
  }, [fulfillment, zoneId, store, addressMunicipality, addressCity]);

  // Revalida o carrinho no servidor (a mesma autoridade do carrinho).
  useEffect(() => {
    if (cart.lines.length === 0) return;
    const controller = new AbortController();
    setQuoteFailed(false);
    // Com entrega ao domicílio, o servidor calcula também o preço da entrega
    // (zona escolhida / preço fixo / gratuita) — nunca o navegador.
    postCartQuote(
      {
        ...buildQuoteRequest(cart),
        ...(fulfillment === 'DELIVERY' ? { fulfillment, ...(zoneId ? { deliveryZoneId: zoneId } : {}) } : {}),
      },
      controller.signal,
    )
      .then((result) => setQuote(result))
      .catch(() => {
        if (!controller.signal.aborted) setQuoteFailed(true);
      });
    return () => controller.abort();
  }, [cart, fulfillment, zoneId]);

  // Resumo de fidelização do cliente (privado; opcional no checkout).
  useEffect(() => {
    if (session.kind !== 'authenticated') return;
    const controller = new AbortController();
    fetchLoyalty(controller.signal)
      .then((result) => setLoyalty(result))
      .catch(() => {
        // Fidelização opcional: o checkout funciona na mesma; a página
        // própria de fidelização mostra o estado de erro com nova tentativa.
      });
    return () => controller.abort();
  }, [session.kind]);

  /* --------------------------- Estados de topo --------------------------- */

  if (created) {
    return <Confirmation order={created} />;
  }

  if (session.kind === 'loading') {
    return (
      <div className="lc-container lc-page lc-checkout__state" role="status">
        <Spinner size="lg" />
        <p>A verificar a sessão…</p>
      </div>
    );
  }

  if (session.kind === 'anonymous') {
    return (
      <div className="lc-container lc-page lc-checkout">
        <header className="lc-checkout__head">
          <hr className="lc-ornament" />
          <h1 className="lc-checkout__title">Checkout</h1>
          <p className="lc-checkout__lead">
            A encomenda fica associada à sua conta — assim fica o histórico e conseguimos acompanhar a confirmação.
          </p>
        </header>
        <div className="lc-checkout__signin">
          <Button size="lg" onClick={() => navigate('/entrar', { state: { from: '/checkout' } })}>
            Entrar para continuar
          </Button>
          <p>
            Ainda não tem conta?{' '}
            <Link to="/registar" state={{ from: '/checkout' }}>
              Criar conta
            </Link>
          </p>
        </div>
      </div>
    );
  }

  if (cart.lines.length === 0) {
    return (
      <div className="lc-container lc-page lc-checkout">
        <header className="lc-checkout__head">
          <hr className="lc-ornament" />
          <h1 className="lc-checkout__title">Checkout</h1>
        </header>
        <div className="lc-checkout__state" role="status">
          <p>O seu carrinho está vazio — não há nada para finalizar.</p>
          <ButtonLink to="/loja">Ir para a loja</ButtonLink>
        </div>
      </div>
    );
  }

  /* -------------------------------- Submit ------------------------------- */

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!quote?.valid || !paymentMethod) return;

    setSubmitting(true);
    setError(null);
    try {
      const request = buildQuoteRequest(cart);
      const loyaltyRequest = loyaltyBody();
      const order = await createOrder({
        contactName: contactName.trim(),
        contactPhone: contactPhone.trim(),
        fulfillment,
        ...(fulfillment === 'DELIVERY'
          ? {
              addressLine1: addressLine1.trim(),
              addressLine2: addressLine2.trim() || undefined,
              addressCity: addressCity.trim(),
              addressMunicipality: addressMunicipality.trim() || undefined,
            }
          : {}),
        ...(fulfillment === 'DELIVERY' && zoneId ? { deliveryZoneId: zoneId } : {}),
        ...(fulfillment === 'PICKUP' && pickupSlot.trim() ? { pickupSlot: pickupSlot.trim() } : {}),
        ...(termsAccepted ? { termsAccepted: true } : {}),
        paymentMethod,
        notes: notes.trim() || undefined,
        productLines: request.productLines,
        cakeLines: request.cakeLines,
        ...loyaltyRequest,
      });
      clearCart();
      setCreated(order);
      window.scrollTo({ top: 0 });
    } catch (caught) {
      setError(toSubmitError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  const zones = (store?.deliveryZones ?? []).filter((zone) => zone.priced !== false && zone.fee !== null);
  const selectedZone = zones.find((zone) => zone.id === zoneId) ?? null;
  const termsRequired = store?.settings.termsRequired === true;
  // Preço fixo / gratuita: sem escolha de zona. Por zonas (ou configuração antiga com zonas): zona obrigatória.
  const deliveryMode = store?.delivery?.mode ?? (zones.length > 0 ? 'ZONES' : null);
  const needsZone = deliveryMode === 'ZONES';
  // Entrega calculada pelo servidor para esta zona/carrinho (nulo = ainda a calcular ou levantamento).
  const deliveryQuote = fulfillment === 'DELIVERY' ? (quote?.delivery ?? null) : null;
  const deliveryOk = fulfillment !== 'DELIVERY' || deliveryQuote?.available === true;
  const deliveryFee = deliveryOk && deliveryQuote?.fee != null ? Number.parseFloat(deliveryQuote.fee) : null;
  const deliveryIssue = fulfillment === 'DELIVERY' && deliveryQuote && !deliveryQuote.available ? deliveryQuote.issue : null;
  const canSubmit =
    quote?.valid === true &&
    paymentMethod !== null &&
    !submitting &&
    deliveryOk &&
    (!termsRequired || termsAccepted);
  const localTotal = cartTotal(cart);
  // `cartTotal` devolve string decimal (convenção monetária) — para a
  // estimativa de desconto converte-se uma única vez para número.
  const localTotalValue = Number.parseFloat(localTotal);

  /* --------------------------- Fidelização (fase 6) --------------------------- */

  const balance = loyalty?.pointsBalance ?? 0;
  const partialAllowed = loyalty?.allowPartialRedemption === true;
  const pointValue = Number.parseFloat(loyalty?.pointValueKz ?? '0');
  // Teto de pontos que o valor desta encomenda chega a absorver (a estimativa
  // é só orientação; o servidor valida e decide o valor final no registo).
  const maxAffordablePoints =
    Number.isFinite(pointValue) && pointValue > 0 && quote?.valid
      ? Math.floor(Number.parseFloat(quote.total) / pointValue)
      : 0;
  const selectedRewardStatus =
    loyalty?.rewards.find((status) => status.eligible && status.reward.code === selectedRewardCode) ??
    null;
  const typedPoints = Number.parseInt(pointsInput, 10);
  const pointsToSpendValue = !usePoints
    ? 0
    : Math.min(
        partialAllowed ? (Number.isFinite(typedPoints) && typedPoints > 0 ? typedPoints : 0) : balance,
        balance,
        maxAffordablePoints,
      );

  let estimatedDiscount = 0;
  if (usePoints && pointsToSpendValue > 0 && Number.isFinite(pointValue)) {
    estimatedDiscount = Math.min(pointsToSpendValue * pointValue, localTotalValue);
  } else if (selectedRewardStatus) {
    estimatedDiscount = Math.min(
      Number.parseFloat(selectedRewardStatus.reward.discountAmount),
      localTotalValue,
    );
  } else if (loyalty?.welcome?.eligible) {
    estimatedDiscount = (localTotalValue * Number.parseFloat(loyalty.welcome.percent)) / 100;
  }

  function loyaltyBody(): { pointsToSpend?: number; rewardCode?: string } {
    if (usePoints && pointsToSpendValue > 0) return { pointsToSpend: pointsToSpendValue };
    if (selectedRewardStatus) return { rewardCode: selectedRewardStatus.reward.code };
    return {};
  }

  return (
    <div className="lc-container lc-page lc-checkout">
      <header className="lc-checkout__head">
        <hr className="lc-ornament" />
        <h1 className="lc-checkout__title">Checkout</h1>
        <p className="lc-checkout__lead">
          Confirme os seus dados e a modalidade. No momento de registar, o servidor volta a validar o carrinho e é
          esse valor que fica na encomenda.
        </p>
      </header>

      <div className="lc-checkout__layout">
        <form className="lc-checkout__form" onSubmit={handleSubmit} noValidate>
          {error && (
            <div className="lc-checkout__banner lc-checkout__banner--danger" role="alert">
              <p className="lc-checkout__banner-title">
                {error.cartRejected ? 'O carrinho mudou e precisa de revisão' : 'Não foi possível registar a encomenda'}
              </p>
              <p>{error.message}</p>
              {error.issues.length > 0 && (
                <ul className="lc-checkout__issues">
                  {error.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              )}
              {error.cartRejected && (
                <ButtonLink variant="secondary" size="sm" to="/carrinho">
                  Rever carrinho
                </ButtonLink>
              )}
            </div>
          )}

          <section className="lc-checkout__section" aria-labelledby="checkout-contacto">
            <h2 id="checkout-contacto">Contacto</h2>
            <div className="lc-checkout__grid">
              <div className="lc-checkout__field">
                <label htmlFor="checkout-name">Nome de quem recebe</label>
                <input
                  id="checkout-name"
                  required
                  minLength={2}
                  maxLength={120}
                  autoComplete="name"
                  value={contactName}
                  onChange={(event) => setContactName(event.target.value)}
                  aria-invalid={Boolean(error?.fieldErrors.contactName)}
                />
                {error?.fieldErrors.contactName && (
                  <p className="lc-checkout__field-error">{error.fieldErrors.contactName}</p>
                )}
              </div>
              <div className="lc-checkout__field">
                <label htmlFor="checkout-phone">Telefone</label>
                <input
                  id="checkout-phone"
                  required
                  maxLength={30}
                  type="tel"
                  autoComplete="tel"
                  value={contactPhone}
                  onChange={(event) => setContactPhone(event.target.value)}
                  aria-invalid={Boolean(error?.fieldErrors.contactPhone)}
                />
                {error?.fieldErrors.contactPhone && (
                  <p className="lc-checkout__field-error">{error.fieldErrors.contactPhone}</p>
                )}
              </div>
            </div>
          </section>

          <section className="lc-checkout__section" aria-labelledby="checkout-modalidade">
            <h2 id="checkout-modalidade">Modalidade</h2>
            <div className="lc-checkout__choices">
              {(Object.keys(FULFILLMENT_LABELS) as Fulfillment[])
                .filter((option) =>
                  option === 'PICKUP' ? store?.settings.pickupEnabled !== false : store?.settings.deliveryEnabled !== false,
                )
                .map((option) => (
                <label key={option} className="lc-checkout__choice">
                  <input
                    type="radio"
                    name="fulfillment"
                    value={option}
                    checked={fulfillment === option}
                    onChange={() => setFulfillment(option)}
                  />
                  <span>
                    <span className="lc-checkout__choice-name">{FULFILLMENT_LABELS[option]}</span>
                    {option === 'DELIVERY' && (
                      <span className="lc-checkout__choice-note">
                        {store?.delivery && !store.delivery.available
                          ? 'Entrega ao domicílio indisponível de momento — escolha levantamento.'
                          : needsZone
                            ? 'Escolha a zona de entrega; o custo é calculado e mostrado antes de confirmar.'
                            : 'O custo da entrega é calculado e mostrado antes de confirmar.'}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>

            {fulfillment === 'DELIVERY' && deliveryIssue && (
              <p className="lc-checkout__field-error" role="alert" data-testid="delivery-issue">
                {deliveryIssue}
              </p>
            )}

            {fulfillment === 'PICKUP' && store && (
              <div className="lc-checkout__field">
                {(store.settings.pickup.address || store.settings.pickup.hours || store.settings.pickup.instructions) && (
                  <p className="lc-checkout__note">
                    {[store.settings.pickup.address, store.settings.pickup.hours, store.settings.pickup.instructions]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
                {store.settings.pickup.askSlot === 'true' && (
                  <>
                    <label htmlFor="checkout-pickup-slot">Data e hora pretendidas para levantar</label>
                    <input
                      id="checkout-pickup-slot"
                      maxLength={120}
                      value={pickupSlot}
                      onChange={(event) => setPickupSlot(event.target.value)}
                      placeholder="Ex.: sábado, 15h"
                    />
                  </>
                )}
              </div>
            )}

            {fulfillment === 'DELIVERY' && needsZone && zones.length > 0 && (
              <div className="lc-checkout__field">
                <label htmlFor="checkout-zone">Zona de entrega</label>
                <select
                  id="checkout-zone"
                  value={zoneId}
                  onChange={(event) => setZoneId(event.target.value)}
                  aria-invalid={Boolean(error?.fieldErrors.deliveryZoneId)}
                >
                  <option value="">Escolha a zona…</option>
                  {zones.map((zone) => (
                    <option key={zone.id} value={zone.id}>
                      {zone.name} — {zone.freeDelivery || zone.fee === '0.00' ? 'Grátis' : formatKz(zone.fee ?? '0')}
                    </option>
                  ))}
                </select>
                {selectedZone && (selectedZone.leadTime || selectedZone.schedule) && (
                  <p className="lc-checkout__note">{[selectedZone.leadTime, selectedZone.schedule].filter(Boolean).join(' · ')}</p>
                )}
                {error?.fieldErrors.deliveryZoneId && (
                  <p className="lc-checkout__field-error">{error.fieldErrors.deliveryZoneId}</p>
                )}
              </div>
            )}

            {fulfillment === 'DELIVERY' && (
              <div className="lc-checkout__grid lc-checkout__grid--address">
                <div className="lc-checkout__field lc-checkout__field--wide">
                  <label htmlFor="checkout-address1">Morada</label>
                  <input
                    id="checkout-address1"
                    required
                    maxLength={255}
                    autoComplete="address-line1"
                    value={addressLine1}
                    onChange={(event) => setAddressLine1(event.target.value)}
                    aria-invalid={Boolean(error?.fieldErrors.addressLine1)}
                  />
                  {error?.fieldErrors.addressLine1 && (
                    <p className="lc-checkout__field-error">{error.fieldErrors.addressLine1}</p>
                  )}
                </div>
                <div className="lc-checkout__field lc-checkout__field--wide">
                  <label htmlFor="checkout-address2">Complemento (opcional)</label>
                  <input
                    id="checkout-address2"
                    maxLength={255}
                    autoComplete="address-line2"
                    value={addressLine2}
                    onChange={(event) => setAddressLine2(event.target.value)}
                  />
                </div>
                <div className="lc-checkout__field">
                  <label htmlFor="checkout-city">Cidade</label>
                  <input
                    id="checkout-city"
                    required
                    maxLength={120}
                    autoComplete="address-level2"
                    value={addressCity}
                    onChange={(event) => setAddressCity(event.target.value)}
                    aria-invalid={Boolean(error?.fieldErrors.addressCity)}
                  />
                  {error?.fieldErrors.addressCity && (
                    <p className="lc-checkout__field-error">{error.fieldErrors.addressCity}</p>
                  )}
                </div>
                <div className="lc-checkout__field">
                  <label htmlFor="checkout-municipality">Município (opcional)</label>
                  <input
                    id="checkout-municipality"
                    maxLength={120}
                    autoComplete="address-level1"
                    value={addressMunicipality}
                    onChange={(event) => setAddressMunicipality(event.target.value)}
                  />
                </div>
              </div>
            )}
          </section>

          <section className="lc-checkout__section" aria-labelledby="checkout-pagamento">
            <h2 id="checkout-pagamento">Pagamento</h2>
            <div className="lc-checkout__choices">
              {(Object.keys(PAYMENT_LABELS) as PaymentMethod[])
                .filter((option) => store?.settings.paymentMethods.find((m) => m.method === option)?.enabled !== false)
                .map((option) => (
                <label key={option} className="lc-checkout__choice">
                  <input
                    type="radio"
                    name="paymentMethod"
                    value={option}
                    required
                    checked={paymentMethod === option}
                    onChange={() => setPaymentMethod(option)}
                  />
                  <span>
                    <span className="lc-checkout__choice-name">{PAYMENT_LABELS[option].name}</span>
                    <span className="lc-checkout__choice-note">{PAYMENT_LABELS[option].description}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="lc-checkout__note">
              O pagamento é confirmado pela loja — a encomenda fica registada logo de seguida com os valores
              abaixo.
            </p>
          </section>

          {loyalty && (
            <section
              className="lc-checkout__section lc-checkout__loyalty"
              aria-labelledby="checkout-fidelizacao"
            >
              <h2 id="checkout-fidelizacao">Fidelização</h2>
              {!loyalty.configured && (
                <p className="lc-checkout__loyalty-note">
                  O programa de fidelização ainda não está activo — quando a loja definir as regras, os
                  pontos aparecem automaticamente nas suas compras.
                </p>
              )}
              {loyalty.configured && !loyalty.active && (
                <p className="lc-checkout__loyalty-note">
                  O programa de fidelização está pausado neste momento. Pode continuar a comprar
                  normalmente.
                </p>
              )}
              {loyalty.active && (
                <>
                  <p className="lc-checkout__loyalty-note">
                    Saldo actual: <strong>{balance} pontos</strong>
                    {loyalty.welcome?.eligible &&
                      ` · ${loyalty.welcome.label} (${loyalty.welcome.percent.replace('.', ',')}%) — aplicado automaticamente nesta primeira compra`}
                    . Só é possível um desconto por encomenda.
                  </p>

                  {balance > 0 && (
                    <div className="lc-checkout__loyalty-options">
                      <div className="lc-checkout__loyalty-option">
                        <input
                          id="checkout-use-points"
                          type="checkbox"
                          checked={usePoints}
                          onChange={(event) => {
                            const next = event.target.checked;
                            setUsePoints(next);
                            if (next) {
                              setSelectedRewardCode(null);
                              if (partialAllowed && !pointsInput) setPointsInput(String(balance));
                            }
                          }}
                        />
                        <div className="lc-checkout__loyalty-option-body">
                          <label htmlFor="checkout-use-points">Usar os meus pontos</label>
                          <span className="lc-checkout__loyalty-option-hint">
                            {partialAllowed
                              ? `Até ${balance} pontos · 1 ponto = ${formatKz(pointValue)} no resgate`
                              : `Serão usados todos os ${balance} pontos — o programa só permite resgate total`}
                          </span>
                          {usePoints && partialAllowed && (
                            <div className="lc-checkout__loyalty-points-input">
                              <label htmlFor="checkout-points" className="lc-visually-hidden">
                                Quantos pontos usar
                              </label>
                              <input
                                id="checkout-points"
                                type="number"
                                min={1}
                                max={Math.max(1, Math.min(balance, maxAffordablePoints))}
                                value={pointsInput}
                                onChange={(event) => setPointsInput(event.target.value)}
                              />
                              <span>
                                pontos
                                {pointsToSpendValue > 0 &&
                                  ` ≈ ${formatKz(Math.min(pointsToSpendValue * pointValue, localTotalValue))}`}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {loyalty.rewards
                        .filter((status) => status.eligible)
                        .map((status) => (
                          <div
                            key={status.reward.code}
                            className="lc-checkout__loyalty-option"
                          >
                            <input
                              id={`checkout-reward-${status.reward.code}`}
                              type="checkbox"
                              checked={selectedRewardCode === status.reward.code}
                              onChange={(event) => {
                                const next = event.target.checked;
                                setSelectedRewardCode(next ? status.reward.code : null);
                                if (next) {
                                  setUsePoints(false);
                                  setPointsInput('');
                                }
                              }}
                            />
                            <div className="lc-checkout__loyalty-option-body">
                              <label htmlFor={`checkout-reward-${status.reward.code}`}>
                                {status.reward.description}
                              </label>
                              <span className="lc-checkout__loyalty-option-hint">
                                {formatKz(status.reward.discountAmount)} de desconto · utilização{' '}
                                {status.reward.maxPerCustomer === 1
                                  ? 'única'
                                  : `até ${status.reward.maxPerCustomer}×`}
                              </span>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}

                  {error?.fieldErrors.pointsToSpend && (
                    <p className="lc-checkout__loyalty-error" role="alert">
                      {error.fieldErrors.pointsToSpend}
                    </p>
                  )}
                  {error?.fieldErrors.rewardCode && (
                    <p className="lc-checkout__loyalty-error" role="alert">
                      {error.fieldErrors.rewardCode}
                    </p>
                  )}
                </>
              )}
            </section>
          )}

          <section className="lc-checkout__section" aria-labelledby="checkout-notas">
            <h2 id="checkout-notas">Notas (opcional)</h2>
            <div className="lc-checkout__field">
              <label htmlFor="checkout-notes" className="lc-visually-hidden">
                Notas para a loja
              </label>
              <textarea
                id="checkout-notes"
                rows={3}
                maxLength={500}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Ex.: alergias, horário preferido, mensagem no bolo…"
              />
            </div>
          </section>

          {termsRequired && (
            <label className="lc-checkout__choice">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(event) => setTermsAccepted(event.target.checked)}
              />
              <span>
                Li e aceito os <Link to="/informacoes/termos" target="_blank">termos e condições</Link>.
                {error?.fieldErrors.termsAccepted && (
                  <span className="lc-checkout__field-error"> {error.fieldErrors.termsAccepted}</span>
                )}
              </span>
            </label>
          )}

          <Button type="submit" size="lg" fullWidth loading={submitting} disabled={!canSubmit}>
            {quote?.valid === false ? 'Corrija o carrinho para continuar' : 'Registar encomenda'}
          </Button>
        </form>

        <Card as="section" elevation="raised" padding="lg" className="lc-checkout__summary" aria-labelledby="checkout-resumo">
          <h2 id="checkout-resumo">Resumo</h2>
          <ul className="lc-checkout__lines">
            {cart.lines.map((line, index) => (
              <li key={`${line.kind}-${line.kind === 'PRODUCT' ? line.productId : index}`}>
                <span className="lc-checkout__line-name">
                  {line.name}
                  {line.kind === 'CAKE' && <span className="lc-checkout__line-tag"> Cake Studio</span>}
                </span>
                <span className="lc-checkout__line-qty">×{line.quantity}</span>
                <span className="lc-checkout__line-price">{formatKz(line.unitPrice)}</span>
              </li>
            ))}
          </ul>

          {quoteFailed && (
            <p className="lc-checkout__banner lc-checkout__banner--warning" role="alert">
              Não foi possível confirmar os preços agora. Pode tentar registar mesmo assim — o servidor volta a
              validar no momento de criar a encomenda.
            </p>
          )}

          <dl className="lc-checkout__totals">
            <div className="lc-checkout__total-row">
              <dt>Total estimado ({cartQuantity(cart)} artigos)</dt>
              <dd>{formatKz(localTotal)}</dd>
            </div>
            {fulfillment === 'DELIVERY' && (
              <div className="lc-checkout__total-row" data-testid="delivery-row">
                <dt>Entrega ao domicílio{deliveryQuote?.zoneName ? ` (${deliveryQuote.zoneName})` : ''}</dt>
                <dd>
                  {deliveryFee === null
                    ? deliveryIssue
                      ? 'por definir'
                      : 'a calcular…'
                    : deliveryFee === 0
                      ? 'Grátis'
                      : formatKz(deliveryFee)}
                </dd>
              </div>
            )}
            {estimatedDiscount > 0 && (
              <div className="lc-checkout__total-row">
                <dt>Desconto estimado (fidelização)</dt>
                <dd>− {formatKz(estimatedDiscount)}</dd>
              </div>
            )}
            <div className="lc-checkout__total-row lc-checkout__total-row--grand">
              <dt>
                Total confirmado pelo servidor
                {estimatedDiscount > 0 ? ' (antes do desconto)' : ''}
              </dt>
              <dd>{quote ? formatKz(quote.grandTotal ?? quote.total) : '—'}</dd>
            </div>
          </dl>

          {estimatedDiscount > 0 && (
            <p className="lc-checkout__note">
              O desconto de fidelização é calculado pelo servidor no momento de registar — o valor final
              aparece na encomenda criada.
            </p>
          )}

          <p className="lc-checkout__note">
            Nada é cobrado automaticamente. A loja confirma o pagamento e combina consigo a entrega ou o
            levantamento.
          </p>
        </Card>
      </div>
    </div>
  );
}

/** Confirmação depois de criada: número de encomenda e valores registados. */
function Confirmation({ order }: { order: OrderView }) {
  const first = order.contactName.trim().split(' ')[0];

  return (
    <div className="lc-container lc-page lc-checkout">
      <header className="lc-checkout__head">
        <hr className="lc-ornament" />
        <Badge tone="success">Encomenda registada</Badge>
        <h1 className="lc-checkout__title">Obrigado, {first}!</h1>
        <p className="lc-checkout__lead">
          A sua encomenda <strong>{order.number}</strong> ficou registada com os valores confirmados pelo servidor.
          Guarde este número como referência.
        </p>
      </header>

      <Card as="section" elevation="raised" padding="lg" className="lc-checkout__confirmation">
        <h2>O que ficou registado</h2>
        <ul className="lc-checkout__lines">
          {order.items.map((item, index) => (
            <li key={`${item.kind}-${index}`}>
              <span className="lc-checkout__line-name">
                {item.name}
                {item.kind === 'CAKE' && item.summary.length > 0 && (
                  <span className="lc-checkout__line-detail">{item.summary.join(' · ')}</span>
                )}
              </span>
              <span className="lc-checkout__line-qty">×{item.quantity}</span>
              <span className="lc-checkout__line-price">{formatKz(item.lineTotal)}</span>
            </li>
          ))}
        </ul>

        <dl className="lc-checkout__totals">
          <div className="lc-checkout__total-row">
            <dt>Subtotal</dt>
            <dd>{formatKz(order.subtotal)}</dd>
          </div>
          <div className="lc-checkout__total-row">
            <dt>Entrega</dt>
            <dd>{order.fulfillment === 'PICKUP' ? '—' : order.deliveryFee === '0.00' ? 'Grátis' : formatKz(order.deliveryFee)}</dd>
          </div>
          {order.discountAmount !== '0.00' && (
            <div className="lc-checkout__total-row">
              <dt>
                {order.discountLabel ?? 'Desconto'}
                {order.pointsSpent > 0 && ` (${order.pointsSpent} pontos usados)`}
              </dt>
              <dd>− {formatKz(order.discountAmount)}</dd>
            </div>
          )}
          <div className="lc-checkout__total-row lc-checkout__total-row--grand">
            <dt>Total</dt>
            <dd>{formatKz(order.total)}</dd>
          </div>
        </dl>

        {order.pointsSpent > 0 && (
          <p className="lc-checkout__note">
            Os pontos usados foram debitados da sua conta e devolvidos automaticamente se cancelar
            esta encomenda antes de a loja a confirmar.
          </p>
        )}

        <p className="lc-checkout__note">
          {FULFILLMENT_LABELS[order.fulfillment]} · {PAYMENT_LABELS[order.paymentMethod].name}. A loja entra em
          contacto no telefone {order.contactPhone} para confirmar e combinar os detalhes.
        </p>

        <ButtonLink to="/loja">Continuar a comprar</ButtonLink>
      </Card>

      <PaymentInstructionsCard
        orderNumber={order.number}
        method={order.paymentMethod}
        paymentStatus={order.paymentStatus}
      />
    </div>
  );
}
