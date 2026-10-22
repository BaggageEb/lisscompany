import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  ApiError,
  adjustLoyaltyPoints,
  fetchAdminDiscounts,
  fetchAdminLoyaltyAccounts,
  fetchAdminLoyaltyConfig,
  saveAdminLoyaltyRule,
  upsertAdminDiscount,
  upsertAdminReward,
  type DiscountRuleView,
  type LoyaltyAdminAccountView,
  type LoyaltyAdminConfig,
  type LoyaltyAdminRewardView,
} from '../../lib/api';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Spinner } from '../../components/ui/Spinner';
import './admin.css';

const ROUNDING_OPTIONS: { value: string; label: string }[] = [
  { value: 'HALF_UP', label: 'Arredondar ao mais próximo (HALF_UP)' },
  { value: 'DOWN', label: 'Arredondar para baixo (DOWN)' },
];

/**
 * Fidelização no painel (fase 6/7): a regra única, as recompensas por
 * código, as regras de desconto com prioridade (#11) e as contas com ajuste
 * manual. Nada vem por omissão — sem regra configurada o painel diz que o
 * programa por configurar, e o servidor é quem valida cada valor guardado.
 */
export function AdminLoyaltyPage() {
  const [config, setConfig] = useState<LoyaltyAdminConfig | null>(null);
  const [discounts, setDiscounts] = useState<DiscountRuleView[] | null>(null);
  const [accounts, setAccounts] = useState<LoyaltyAdminAccountView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Formulário da regra
  const [earnPercent, setEarnPercent] = useState('');
  const [pointValueKz, setPointValueKz] = useState('');
  const [rounding, setRounding] = useState('HALF_UP');
  const [allowPartial, setAllowPartial] = useState(true);
  const [ruleActive, setRuleActive] = useState(true);

  // Formulário de recompensa
  const [rewardCode, setRewardCode] = useState('');
  const [rewardDescription, setRewardDescription] = useState('');
  const [rewardMinPoints, setRewardMinPoints] = useState('');
  const [rewardMinOrders, setRewardMinOrders] = useState('');
  const [rewardAmount, setRewardAmount] = useState('');
  const [rewardMax, setRewardMax] = useState('1');
  const [rewardActive, setRewardActive] = useState(true);

  // Formulário de desconto
  const [discountCode, setDiscountCode] = useState('');
  const [discountDescription, setDiscountDescription] = useState('');
  const [discountKind, setDiscountKind] = useState<'WELCOME' | 'REWARD'>('WELCOME');
  const [discountPercent, setDiscountPercent] = useState('');
  const [discountAmount, setDiscountAmount] = useState('');
  const [discountRewardCode, setDiscountRewardCode] = useState('');
  const [discountPriority, setDiscountPriority] = useState('1');
  const [discountActive, setDiscountActive] = useState(true);

  // Ajuste de conta
  const [openAccount, setOpenAccount] = useState<string | null>(null);
  const [adjustPoints, setAdjustPoints] = useState('');
  const [adjustNote, setAdjustNote] = useState('');

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    fetchAdminLoyaltyConfig(controller.signal)
      .then((result) => {
        setConfig(result);
        if (result.rule) {
          setEarnPercent(result.rule.earnPercent);
          setPointValueKz(result.rule.pointValueKz);
          setRounding(result.rule.rounding);
          setAllowPartial(result.rule.allowPartialRedemption);
          setRuleActive(result.rule.active);
        }
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          caught instanceof ApiError
            ? caught.message
            : 'Não foi possível carregar a configuração de fidelização.',
        );
      });
    fetchAdminDiscounts(controller.signal)
      .then(setDiscounts)
      .catch(() => {
        /* erro global já coberto pela regra */
      });
    fetchAdminLoyaltyAccounts(controller.signal)
      .then(setAccounts)
      .catch(() => {
        /* erro global já coberto pela regra */
      });
    return () => controller.abort();
  }, [reloadKey]);

  function fail(caught: unknown) {
    if (caught instanceof ApiError) {
      const fieldIssue = Object.values(caught.fieldErrors)[0];
      setError(fieldIssue ?? caught.message);
    } else {
      setError('Não foi possível guardar. Tente novamente.');
    }
    setSuccess(null);
  }

  async function submitRule(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await saveAdminLoyaltyRule({
        earnPercent: earnPercent.trim(),
        pointValueKz: pointValueKz.trim(),
        rounding,
        allowPartialRedemption: allowPartial,
        active: ruleActive,
      });
      setSuccess('Regra de fidelização guardada.');
      reload();
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  }

  function editReward(reward: LoyaltyAdminRewardView) {
    setRewardCode(reward.code);
    setRewardDescription(reward.description);
    setRewardMinPoints(reward.minPoints === null ? '' : String(reward.minPoints));
    setRewardMinOrders(reward.minOrders === null ? '' : String(reward.minOrders));
    setRewardAmount(reward.discountAmount);
    setRewardMax(String(reward.maxPerCustomer));
    setRewardActive(reward.active);
  }

  async function submitReward(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await upsertAdminReward({
        code: rewardCode.trim().toUpperCase(),
        description: rewardDescription.trim(),
        minPoints: rewardMinPoints.trim() ? Number.parseInt(rewardMinPoints, 10) : undefined,
        minOrders: rewardMinOrders.trim() ? Number.parseInt(rewardMinOrders, 10) : undefined,
        discountAmount: rewardAmount.trim(),
        maxPerCustomer: Number.parseInt(rewardMax, 10) || 1,
        active: rewardActive,
      });
      setSuccess(`Recompensa ${rewardCode.trim().toUpperCase()} guardada.`);
      reload();
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  }

  function editDiscount(rule: DiscountRuleView) {
    setDiscountCode(rule.code);
    setDiscountDescription(rule.description);
    setDiscountKind(rule.kind);
    setDiscountPercent(rule.percent ?? '');
    setDiscountAmount(rule.amount ?? '');
    setDiscountRewardCode(rule.rewardCode ?? '');
    setDiscountPriority(String(rule.priority));
    setDiscountActive(rule.active);
  }

  async function submitDiscount(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await upsertAdminDiscount({
        code: discountCode.trim().toUpperCase(),
        description: discountDescription.trim(),
        kind: discountKind,
        percent: discountKind === 'WELCOME' ? discountPercent.trim() : undefined,
        amount: discountKind === 'REWARD' ? discountAmount.trim() : undefined,
        rewardCode: discountKind === 'REWARD' ? discountRewardCode.trim().toUpperCase() : undefined,
        priority: Number.parseInt(discountPriority, 10) || 1,
        active: discountActive,
      });
      setSuccess(`Regra de desconto ${discountCode.trim().toUpperCase()} guardada.`);
      reload();
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  }

  async function submitAdjustment(userId: string) {
    const points = Number.parseInt(adjustPoints, 10);
    if (!Number.isFinite(points) || points === 0) {
      setError('Indique os pontos a ajustar: positivo soma, negativo subtrai.');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await adjustLoyaltyPoints(userId, { points, note: adjustNote.trim() || undefined });
      setSuccess('Ajuste de pontos registado no livro-razão do cliente.');
      setOpenAccount(null);
      setAdjustPoints('');
      setAdjustNote('');
      reload();
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  }

  if (config === null && error === null) {
    return (
      <div className="lc-admin__state" role="status">
        <Spinner />
        <p>A carregar configuração de fidelização…</p>
      </div>
    );
  }

  return (
    <>
      {success && (
        <div className="lc-admin__banner lc-admin__banner--success" role="status">
          <p>{success}</p>
        </div>
      )}
      {error && (
        <div className="lc-admin__banner lc-admin__banner--danger" role="alert">
          <p>{error}</p>
        </div>
      )}

      {/* ------------------------------ Regra ------------------------------ */}
      <Card as="section" elevation="raised" padding="lg" className="lc-admin__section">
        <h2>Regra de fidelização</h2>
        <p className="lc-admin__section-note">
          {config?.rule
            ? `Actualizada a ${new Date(config.rule.updatedAt).toLocaleString('pt-PT')}.`
            : 'Programa por configurar: os clientes ainda não acumulam pontos nem resgatam. Preencha os valores que a loja decidiu — nenhum vem por omissão.'}
        </p>

        <form onSubmit={submitRule} noValidate>
          <div className="lc-admin__form-grid">
            <div className="lc-admin__field">
              <label htmlFor="rule-earn">Percentagem acumulada (%)</label>
              <input
                id="rule-earn"
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={earnPercent}
                onChange={(event) => setEarnPercent(event.target.value)}
                placeholder="Ex.: 10"
              />
            </div>
            <div className="lc-admin__field">
              <label htmlFor="rule-value">Valor de 1 ponto no resgate (Kz)</label>
              <input
                id="rule-value"
                type="number"
                step="0.0001"
                min="0"
                value={pointValueKz}
                onChange={(event) => setPointValueKz(event.target.value)}
                placeholder="Ex.: 1"
              />
            </div>
            <div className="lc-admin__field">
              <label htmlFor="rule-rounding">Arredondamento de pontos</label>
              <select id="rule-rounding" value={rounding} onChange={(event) => setRounding(event.target.value)}>
                {ROUNDING_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="lc-admin__actions" style={{ marginTop: 'var(--lc-space-4)' }}>
            <label className="lc-admin__checkbox">
              <input
                type="checkbox"
                checked={allowPartial}
                onChange={(event) => setAllowPartial(event.target.checked)}
              />
              Permitir resgate parcial (cliente escolhe quantos pontos usar)
            </label>
            <label className="lc-admin__checkbox">
              <input
                type="checkbox"
                checked={ruleActive}
                onChange={(event) => setRuleActive(event.target.checked)}
              />
              Programa activo
            </label>
          </div>

          <div className="lc-admin__actions" style={{ marginTop: 'var(--lc-space-4)' }}>
            <Button type="submit" loading={busy} disabled={busy}>
              Guardar regra
            </Button>
          </div>
        </form>
      </Card>

      {/* --------------------------- Recompensas --------------------------- */}
      <Card as="section" elevation="flat" padding="lg" className="lc-admin__section">
        <h2>Recompensas</h2>
        <p className="lc-admin__section-note">
          Cada recompensa tem código público (o cliente escolhe pelo código, nunca por identificadores) e
          condições que o servidor valida: pontos e/ou número de encomendas.
        </p>

        {config !== null && config.rewards.length === 0 && (
          <p className="lc-admin__empty">Ainda não há recompensas — crie a primeira no formulário.</p>
        )}

        {config !== null && config.rewards.length > 0 && (
          <ul className="lc-admin__list">
            {config.rewards.map((reward) => (
              <li key={reward.code}>
                <div className="lc-admin__row">
                  <div className="lc-admin__row-main">
                    <span className="lc-admin__row-title">{reward.description}</span>
                    <span className="lc-admin__row-meta">
                      {reward.code} ·{' '}
                      {reward.minPoints !== null && `${reward.minPoints} pontos`}
                      {reward.minPoints !== null && reward.minOrders !== null && ' e '}
                      {reward.minOrders !== null && `${reward.minOrders} encomendas`} ·{' '}
                      {reward.discountAmount} Kz de desconto · máx. {reward.maxPerCustomer} por cliente
                    </span>
                  </div>
                  <div className="lc-admin__row-side">
                    <Badge tone={reward.active ? 'success' : 'neutral'}>
                      {reward.active ? 'Activa' : 'Inactiva'}
                    </Badge>
                    <Button variant="secondary" size="sm" onClick={() => editReward(reward)}>
                      Editar
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={submitReward} noValidate>
          <h3 style={{ fontSize: 'var(--lc-text-sm)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Nova / editar recompensa
          </h3>
          <div className="lc-admin__form-grid" style={{ marginTop: 'var(--lc-space-3)' }}>
            <div className="lc-admin__field">
              <label htmlFor="reward-code">Código</label>
              <input
                id="reward-code"
                maxLength={40}
                value={rewardCode}
                onChange={(event) => setRewardCode(event.target.value)}
                placeholder="Ex.: META_10K"
              />
            </div>
            <div className="lc-admin__field">
              <label htmlFor="reward-description">Descrição (o que o cliente vê)</label>
              <input
                id="reward-description"
                maxLength={200}
                value={rewardDescription}
                onChange={(event) => setRewardDescription(event.target.value)}
                placeholder="Ex.: Bolo grátis ao atingir a meta"
              />
            </div>
            <div className="lc-admin__field">
              <label htmlFor="reward-amount">Desconto em Kz</label>
              <input
                id="reward-amount"
                type="number"
                step="0.01"
                min="0"
                value={rewardAmount}
                onChange={(event) => setRewardAmount(event.target.value)}
                placeholder="Ex.: 1000"
              />
            </div>
            <div className="lc-admin__field">
              <label htmlFor="reward-min-points">Mínimo de pontos (condição)</label>
              <input
                id="reward-min-points"
                type="number"
                step={1}
                min="0"
                value={rewardMinPoints}
                onChange={(event) => setRewardMinPoints(event.target.value)}
                placeholder="Ex.: 10000"
              />
            </div>
            <div className="lc-admin__field">
              <label htmlFor="reward-min-orders">Mínimo de encomendas (condição)</label>
              <input
                id="reward-min-orders"
                type="number"
                step={1}
                min="0"
                value={rewardMinOrders}
                onChange={(event) => setRewardMinOrders(event.target.value)}
                placeholder="Ex.: 5"
              />
            </div>
            <div className="lc-admin__field">
              <label htmlFor="reward-max">Usos máximos por cliente</label>
              <input
                id="reward-max"
                type="number"
                step={1}
                min="1"
                value={rewardMax}
                onChange={(event) => setRewardMax(event.target.value)}
              />
            </div>
          </div>
          <div className="lc-admin__actions" style={{ marginTop: 'var(--lc-space-4)' }}>
            <label className="lc-admin__checkbox">
              <input
                type="checkbox"
                checked={rewardActive}
                onChange={(event) => setRewardActive(event.target.checked)}
              />
              Recompensa activa
            </label>
            <Button type="submit" loading={busy} disabled={busy}>
              Guardar recompensa
            </Button>
          </div>
        </form>
      </Card>

      {/* --------------------------- Descontos ----------------------------- */}
      <Card as="section" elevation="flat" padding="lg" className="lc-admin__section">
        <h2>Regras de desconto</h2>
        <p className="lc-admin__section-note">
          Exactamente UM desconto por encomenda (decisão #11). A prioridade (1 = maior precedência) é única
          entre regras activas — o servidor garante isso em cada gravação.
        </p>

        {discounts !== null && discounts.length === 0 && (
          <p className="lc-admin__empty">
            Sem regras de desconto — o desconto de boas-vindas e o de recompensa entram por aqui.
          </p>
        )}

        {discounts !== null && discounts.length > 0 && (
          <ul className="lc-admin__list">
            {discounts.map((rule) => (
              <li key={rule.code}>
                <div className="lc-admin__row">
                  <div className="lc-admin__row-main">
                    <span className="lc-admin__row-title">{rule.description}</span>
                    <span className="lc-admin__row-meta">
                      {rule.code} ·{' '}
                      {rule.kind === 'WELCOME' ? 'Boas-vindas' : `Recompensa ${rule.rewardCode ?? ''}`} ·{' '}
                      {rule.percent !== null ? `${rule.percent}%` : `${rule.amount} Kz`} · prioridade{' '}
                      {rule.priority}
                    </span>
                  </div>
                  <div className="lc-admin__row-side">
                    <Badge tone={rule.active ? 'success' : 'neutral'}>
                      {rule.active ? 'Activa' : 'Inactiva'}
                    </Badge>
                    <Button variant="secondary" size="sm" onClick={() => editDiscount(rule)}>
                      Editar
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={submitDiscount} noValidate>
          <h3 style={{ fontSize: 'var(--lc-text-sm)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Nova / editar regra de desconto
          </h3>
          <div className="lc-admin__form-grid" style={{ marginTop: 'var(--lc-space-3)' }}>
            <div className="lc-admin__field">
              <label htmlFor="discount-code">Código da regra</label>
              <input
                id="discount-code"
                maxLength={40}
                value={discountCode}
                onChange={(event) => setDiscountCode(event.target.value)}
                placeholder="Ex.: WELCOME_5"
              />
            </div>
            <div className="lc-admin__field">
              <label htmlFor="discount-description">Descrição (rótulo para o cliente)</label>
              <input
                id="discount-description"
                maxLength={200}
                value={discountDescription}
                onChange={(event) => setDiscountDescription(event.target.value)}
                placeholder="Ex.: Desconto de boas-vindas"
              />
            </div>
            <div className="lc-admin__field">
              <label htmlFor="discount-kind">Tipo</label>
              <select
                id="discount-kind"
                value={discountKind}
                onChange={(event) => setDiscountKind(event.target.value as 'WELCOME' | 'REWARD')}
              >
                <option value="WELCOME">Boas-vindas (percentagem na primeira compra)</option>
                <option value="REWARD">Recompensa (valor em Kz ligado a uma recompensa)</option>
              </select>
            </div>
            {discountKind === 'WELCOME' ? (
              <div className="lc-admin__field">
                <label htmlFor="discount-percent">Percentagem (%)</label>
                <input
                  id="discount-percent"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={discountPercent}
                  onChange={(event) => setDiscountPercent(event.target.value)}
                  placeholder="Ex.: 5"
                />
              </div>
            ) : (
              <>
                <div className="lc-admin__field">
                  <label htmlFor="discount-reward-code">Recompensa ligada (código)</label>
                  <input
                    id="discount-reward-code"
                    maxLength={40}
                    value={discountRewardCode}
                    onChange={(event) => setDiscountRewardCode(event.target.value)}
                    placeholder="Ex.: META_10K"
                  />
                </div>
                <div className="lc-admin__field">
                  <label htmlFor="discount-amount">Valor em Kz</label>
                  <input
                    id="discount-amount"
                    type="number"
                    step="0.01"
                    min="0"
                    value={discountAmount}
                    onChange={(event) => setDiscountAmount(event.target.value)}
                    placeholder="Ex.: 1000"
                  />
                </div>
              </>
            )}
            <div className="lc-admin__field">
              <label htmlFor="discount-priority">Prioridade (1 = maior)</label>
              <input
                id="discount-priority"
                type="number"
                step={1}
                min="1"
                value={discountPriority}
                onChange={(event) => setDiscountPriority(event.target.value)}
              />
            </div>
          </div>
          <div className="lc-admin__actions" style={{ marginTop: 'var(--lc-space-4)' }}>
            <label className="lc-admin__checkbox">
              <input
                type="checkbox"
                checked={discountActive}
                onChange={(event) => setDiscountActive(event.target.checked)}
              />
              Regra activa
            </label>
            <Button type="submit" loading={busy} disabled={busy}>
              Guardar regra de desconto
            </Button>
          </div>
        </form>
      </Card>

      {/* ----------------------------- Contas ------------------------------ */}
      <Card as="section" elevation="flat" padding="lg" className="lc-admin__section">
        <h2>Contas de clientes</h2>
        <p className="lc-admin__section-note">
          Saldo real de cada conta. Ajustes manuais (estorno ou correção) entram no livro-razão com nota —
          nada muda fora de um movimento registado.
        </p>

        {accounts === null && (
          <div className="lc-admin__state" role="status">
            <Spinner />
            <p>A carregar contas…</p>
          </div>
        )}
        {accounts !== null && accounts.length === 0 && (
          <p className="lc-admin__empty">Ainda não há contas com pontos.</p>
        )}

        {accounts !== null && accounts.length > 0 && (
          <ul className="lc-admin__list">
            {accounts.map((account) => (
              <li key={account.userId}>
                <Card elevation="flat" padding="md">
                  <div className="lc-admin__row">
                    <div className="lc-admin__row-main">
                      <span className="lc-admin__row-title">{account.displayName}</span>
                      <span className="lc-admin__row-meta">
                        {account.email} · total acumulado: {account.lifetimePoints} pontos
                      </span>
                    </div>
                    <div className="lc-admin__row-side">
                      <span className="lc-admin__amount">{account.pointsBalance} pontos</span>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setOpenAccount(openAccount === account.userId ? null : account.userId);
                          setAdjustPoints('');
                          setAdjustNote('');
                        }}
                      >
                        {openAccount === account.userId ? 'Fechar' : 'Ajustar pontos'}
                      </Button>
                    </div>
                  </div>

                  {openAccount === account.userId && (
                    <div className="lc-admin__inline-form">
                      <div className="lc-admin__form-grid">
                        <div className="lc-admin__field">
                          <label htmlFor={`adjust-points-${account.userId}`}>
                            Pontos (positivo soma, negativo subtrai)
                          </label>
                          <input
                            id={`adjust-points-${account.userId}`}
                            type="number"
                            step={1}
                            value={adjustPoints}
                            onChange={(event) => setAdjustPoints(event.target.value)}
                            placeholder="Ex.: 100 ou -50"
                          />
                        </div>
                        <div className="lc-admin__field">
                          <label htmlFor={`adjust-points-note-${account.userId}`}>Nota (opcional)</label>
                          <input
                            id={`adjust-points-note-${account.userId}`}
                            maxLength={200}
                            value={adjustNote}
                            onChange={(event) => setAdjustNote(event.target.value)}
                            placeholder="Ex.: estorno combinado por telefone."
                          />
                        </div>
                      </div>
                      <div className="lc-admin__actions">
                        <Button
                          onClick={() => submitAdjustment(account.userId)}
                          loading={busy}
                          disabled={busy}
                        >
                          Registar ajuste
                        </Button>
                      </div>
                    </div>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
