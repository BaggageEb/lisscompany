import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiError, fetchOrders, type OrderSummaryView } from '../lib/api';
import { formatInstant, orderStatusOf, paymentStatusOf } from '../lib/orderStatus';
import { formatKz } from '../lib/money';
import { useSession } from '../lib/session';
import { Badge } from '../components/ui/Badge';
import { Button, ButtonLink } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import './account.css';

/**
 * «As minhas encomendas» (fase 4/5): a lista vem de `GET /api/v1/orders`,
 * que o backend limita às encomendas do próprio cliente — aqui só se
 * apresenta. Estados de erro de rede são explícitos, com nova tentativa.
 */
export function OrdersPage() {
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();

  const [orders, setOrders] = useState<OrderSummaryView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const retry = useCallback(() => {
    setError(null);
    setOrders(null);
    setReloadKey((key) => key + 1);
  }, []);

  useEffect(() => {
    if (session.kind !== 'authenticated') return;
    const controller = new AbortController();
    fetchOrders(controller.signal)
      .then((result) => setOrders(result))
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          caught instanceof ApiError
            ? caught.message
            : 'Não foi possível carregar as suas encomendas. Tente novamente.',
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
          <h1 className="lc-orders__title">As minhas encomendas</h1>
          <p className="lc-orders__lead">
            Entre para ver o histórico das suas encomendas e acompanhar cada estado.
          </p>
        </header>
        <div className="lc-orders__signin">
          <Button
            size="lg"
            onClick={() => navigate('/entrar', { state: { from: location.pathname } })}
          >
            Entrar para ver encomendas
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

  return (
    <div className="lc-container lc-page lc-orders">
      <header className="lc-orders__head">
        <hr className="lc-ornament" />
        <h1 className="lc-orders__title">As minhas encomendas</h1>
        <p className="lc-orders__lead">
          Histórico completo, com o estado da encomenda e do pagamento, tal como o servidor os
          comunica.
        </p>
      </header>

      {error && (
        <div className="lc-orders__banner lc-orders__banner--danger" role="alert">
          <p>Não foi possível carregar as encomendas.</p>
          <p>{error}</p>
          <Button variant="secondary" size="sm" onClick={retry}>
            Tentar novamente
          </Button>
        </div>
      )}

      {orders === null && !error && (
        <div className="lc-orders__state" role="status">
          <Spinner />
          <p>A carregar as suas encomendas…</p>
        </div>
      )}

      {orders !== null && orders.length === 0 && (
        <Card as="section" elevation="flat" padding="lg" className="lc-orders__empty">
          <h2>Ainda não tem encomendas</h2>
          <p>Quando fizer a primeira encomenda ela aparece aqui, com todos os estados.</p>
          <ButtonLink to="/loja">Ir para a loja</ButtonLink>
        </Card>
      )}

      {orders !== null && orders.length > 0 && (
        <ul className="lc-orders__list">
          {orders.map((order) => {
            const status = orderStatusOf(order.status);
            const payment = paymentStatusOf(order.paymentStatus);
            return (
              <li key={order.number}>
                <Link to={`/conta/encomendas/${order.number}`} className="lc-orders__card-link">
                  <Card elevation="flat" padding="md" className="lc-orders__card">
                    <span className="lc-orders__card-main">
                      <span className="lc-orders__number">{order.number}</span>
                      <span className="lc-orders__date">{formatInstant(order.createdAt)}</span>
                    </span>
                    <span className="lc-orders__badges">
                      <Badge tone={status.tone}>{status.label}</Badge>
                      {payment && <Badge tone={payment.tone}>Pagamento: {payment.label}</Badge>}
                    </span>
                    <span className="lc-orders__card-meta">
                      <span>
                        {order.itemCount} {order.itemCount === 1 ? 'artigo' : 'artigos'}
                      </span>
                      <span className="lc-orders__total">{formatKz(order.total)}</span>
                    </span>
                    <span className="lc-orders__card-cta" aria-hidden="true">
                      Ver detalhe →
                    </span>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
