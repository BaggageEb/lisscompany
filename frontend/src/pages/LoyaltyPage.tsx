import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ApiError,
  fetchLoyalty,
  fetchLoyaltyTransactions,
  type LoyaltySummary,
  type LoyaltyTransactionView,
} from '../lib/api';
import { formatInstant } from '../lib/orderStatus';
import { formatKz } from '../lib/money';
import { useSession } from '../lib/session';
import { Badge } from '../components/ui/Badge';
import { Button, ButtonLink } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import './account.css';
import './loyalty.css';

const TRANSACTION_LABELS: Record<LoyaltyTransactionView['type'], string> = {
  EARN: 'Pontos ganhos',
  REDEEM: 'Pontos usados',
  ADJUSTMENT: 'Ajuste da loja',
};

/**
 * «Fidelização» (fase 6).
 *
 * Esta página nunca inventa regras: o que aparece é exactamente o que o
 * servidor comunica — o programa pode estar *por configurar* (a loja ainda
 * não definiu taxas nem recompensas), *pausado*, ou *activo* com saldo,
 * recompensas e elegibilidade calculadas no servidor. O cliente nunca faz
 * contas de preço: os valores de resgate são estimativas rotuladas e o
 * desconto final é sempre o confirmado pelo backend na encomenda.
 */
export function LoyaltyPage() {
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();

  const [summary, setSummary] = useState<LoyaltySummary | null>(null);
  const [transactions, setTransactions] = useState<LoyaltyTransactionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const retry = useCallback(() => {
    setError(null);
    setSummary(null);
    setTransactions(null);
    setReloadKey((key) => key + 1);
  }, []);

  useEffect(() => {
    if (session.kind !== 'authenticated') return;
    const controller = new AbortController();
    Promise.all([fetchLoyalty(controller.signal), fetchLoyaltyTransactions(controller.signal)])
      .then(([nextSummary, nextTransactions]) => {
        setSummary(nextSummary);
        setTransactions(nextTransactions);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          caught instanceof ApiError
            ? caught.message
            : 'Não foi possível carregar a fidelização. Tente novamente.',
        );
      });
    return () => controller.abort();
  }, [session.kind, reloadKey]);

  if (session.kind === 'loading') {
    return (
      <div className="lc-container lc-page lc-orders__state" role="status">
        <Spinner size="lg" />
        <p>A verificar a sessão…</p>
      </div>
    );
  }

  if (session.kind === 'anonymous') {
    return (
      <div className="lc-container lc-page lc-orders">
        <header className="lc-orders__head">
          <hr className="lc-ornament" />
          <h1 className="lc-orders__title">Fidelização</h1>
          <p className="lc-orders__lead">
            Entre para ver os seus pontos, as recompensas disponíveis e o histórico de movimentos.
          </p>
        </header>
        <div className="lc-orders__signin">
          <Button size="lg" onClick={() => navigate('/entrar', { state: { from: location.pathname } })}>
            Entrar para ver os meus pontos
          </Button>
          <p>
            Ainda não tem conta?{' '}
            <Link to="/registar" state={{ from: location.pathname }}>
              Criar conta
            </Link>
          </p>
        </div>
      </div>
    );
  }

  if (error && summary === null) {
    return (
      <div className="lc-container lc-page lc-orders">
        <header className="lc-orders__head">
          <hr className="lc-ornament" />
          <h1 className="lc-orders__title">Fidelização</h1>
        </header>
        <div className="lc-orders__banner lc-orders__banner--danger" role="alert">
          <p>{error}</p>
          <Button variant="secondary" size="sm" onClick={retry}>
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  if (summary === null) {
    return (
      <div className="lc-container lc-page lc-orders__state" role="status">
        <Spinner />
        <p>A carregar o seu programa de fidelização…</p>
      </div>
    );
  }

  const pointValue = summary.pointValueKz;
  const equivalence =
    summary.active && pointValue !== null && summary.pointsBalance > 0
      ? formatKz(Number.parseFloat(pointValue) * summary.pointsBalance)
      : null;

  return (
    <div className="lc-container lc-page lc-loyalty">
      <header className="lc-orders__head">
        <hr className="lc-ornament" />
        <h1 className="lc-orders__title">Fidelização</h1>
        <p className="lc-orders__lead">
          Os pontos são confirmados pelo servidor em cada encomenda paga — aqui está sempre o valor
          real da sua conta.
        </p>
      </header>

      {error && (
        <div className="lc-orders__banner lc-orders__banner--danger" role="alert">
          <p>{error}</p>
          <Button variant="secondary" size="sm" onClick={retry}>
            Tentar novamente
          </Button>
        </div>
      )}

      <Card as="section" elevation="raised" padding="lg" className="lc-loyalty__balance">
        <h2>O seu saldo</h2>
        <p className="lc-loyalty__points">
          <span className="lc-loyalty__points-value">{summary.pointsBalance}</span>
          <span className="lc-loyalty__points-unit">pontos</span>
        </p>
        {equivalence && (
          <p className="lc-loyalty__equivalence">
            Equivalente a {equivalence} pela taxa de resgate actual (1 ponto = {formatKz(Number.parseFloat(pointValue ?? '0'))}).
          </p>
        )}
        {!summary.configured && (
          <p className="lc-loyalty__note">
            O programa ainda não está activo: a loja vai definir as regras de acumulação e de
            resgate e este painel passa a mostrar tudo automaticamente.
          </p>
        )}
        {summary.configured && !summary.active && (
          <Badge tone="warning">Programa pausado pela loja</Badge>
        )}
        {summary.active && summary.earnPercent !== null && (
          <p className="lc-loyalty__note">
            Cada compra paga acumula {summary.earnPercent}% do valor dos artigos (após descontos, sem
            entrega).
          </p>
        )}
      </Card>

      {(summary.welcome || summary.rewards.length > 0) && (
        <Card as="section" elevation="flat" padding="lg" className="lc-loyalty__perks">
          <h2>Recompensas e descontos</h2>
          {summary.welcome && (
            <div className="lc-loyalty__perk">
              <div className="lc-loyalty__perk-head">
                <strong>{summary.welcome.label}</strong>
                {summary.welcome.eligible ? (
                  <Badge tone="gold">Disponível</Badge>
                ) : (
                  <Badge tone="neutral">Usado</Badge>
                )}
              </div>
              <p>
                {summary.welcome.percent.replace('.', ',')}% na primeira compra — aplicado
                automaticamente pela loja, sem precisar de fazer nada.
              </p>
            </div>
          )}
          {summary.rewards.map((status) => (
            <div key={status.reward.code} className="lc-loyalty__perk">
              <div className="lc-loyalty__perk-head">
                <strong>{status.reward.description}</strong>
                {status.eligible ? (
                  <Badge tone="gold">Disponível</Badge>
                ) : (
                  <Badge tone="neutral">Indisponível</Badge>
                )}
              </div>
              <p>
                Condições:
                {status.reward.minPoints !== null && ` ${status.reward.minPoints} pontos`}
                {status.reward.minPoints !== null && status.reward.minOrders !== null && ' e'}
                {status.reward.minOrders !== null && ` ${status.reward.minOrders} encomendas`} ·{' '}
                {formatKz(status.reward.discountAmount)} de desconto · utilização{' '}
                {status.reward.maxPerCustomer === 1 ? 'única' : `até ${status.reward.maxPerCustomer}×`}
                .
              </p>
              {status.eligible ? (
                <p className="lc-loyalty__perk-hint">
                  Escolha-a no checkout — a encomenda aceita um único desconto.
                </p>
              ) : (
                <p className="lc-loyalty__perk-hint">{status.reason}</p>
              )}
            </div>
          ))}
        </Card>
      )}

      <Card as="section" elevation="flat" padding="lg" className="lc-loyalty__history">
        <h2>Movimentos de pontos</h2>
        {transactions === null && (
          <div className="lc-orders__state" role="status">
            <Spinner />
            <p>A carregar movimentos…</p>
          </div>
        )}
        {transactions !== null && transactions.length === 0 && (
          <p className="lc-loyalty__note">
            Ainda não tem movimentos. Os pontos aparecem aqui automaticamente depois de a loja
            confirmar o pagamento da sua primeira encomenda.
          </p>
        )}
        {transactions !== null && transactions.length > 0 && (
          <ul className="lc-loyalty__transactions">
            {transactions.map((transaction, index) => (
              <li key={`${transaction.type}-${index}`}>
                <span className="lc-loyalty__transaction-main">
                  <span className="lc-loyalty__transaction-label">
                    {TRANSACTION_LABELS[transaction.type]}
                    {transaction.orderNumber && (
                      <span className="lc-loyalty__transaction-order">
                        {' · '}
                        <Link to={`/conta/encomendas/${transaction.orderNumber}`}>
                          {transaction.orderNumber}
                        </Link>
                      </span>
                    )}
                  </span>
                  <span className="lc-loyalty__transaction-date">
                    {formatInstant(transaction.createdAt)}
                  </span>
                </span>
                <span
                  className={`lc-loyalty__transaction-points ${
                    transaction.points > 0 ? 'lc-loyalty__transaction-points--in' : ''
                  }`}
                >
                  {transaction.points > 0 ? `+${transaction.points}` : transaction.points} pts
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <section className="lc-loyalty__actions">
        <ButtonLink to="/loja" variant="secondary">
          Ir fazer uma compra
        </ButtonLink>
      </section>
    </div>
  );
}
