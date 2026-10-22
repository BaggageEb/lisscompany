import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, fetchAdminOrders, type AdminOrderSummary } from '../../lib/api';
import { formatKz } from '../../lib/money';
import { formatInstant, orderStatusOf, paymentStatusOf } from '../../lib/orderStatus';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Spinner } from '../../components/ui/Spinner';
import './admin.css';

const ORDER_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'Todos os estados' },
  { value: 'RECEIVED', label: 'Recebidas' },
  { value: 'CONFIRMED', label: 'Confirmadas' },
  { value: 'PREPARING', label: 'Em preparação' },
  { value: 'READY', label: 'Prontas' },
  { value: 'COMPLETED', label: 'Concluídas' },
  { value: 'CANCELLED', label: 'Canceladas' },
];

const PAYMENT_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'Qualquer pagamento' },
  { value: 'PENDING', label: 'Pagamento por confirmar' },
  { value: 'UNDER_REVIEW', label: 'Em revisão' },
  { value: 'PAID', label: 'Pagos' },
  { value: 'FAILED', label: 'Não confirmados' },
];

/**
 * Encomendas do painel (fase 7): lista com filtros do SERVIDOR (o backend
 * decide o que entra na resposta) e ligação ao detalhe com transições.
 */
export function AdminOrdersPage() {
  const [orders, setOrders] = useState<AdminOrderSummary[] | null>(null);
  const [status, setStatus] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const retry = () => {
    setError(null);
    setOrders(null);
    setReloadKey((key) => key + 1);
  };

  useEffect(() => {
    const controller = new AbortController();
    fetchAdminOrders(
      { status: status || undefined, paymentStatus: paymentStatus || undefined },
      controller.signal,
    )
      .then((result) => {
        setOrders(result);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          caught instanceof ApiError
            ? caught.message
            : 'Não foi possível carregar as encomendas. Tente novamente.',
        );
      });
    return () => controller.abort();
  }, [status, paymentStatus, reloadKey]);

  return (
    <>
      <div className="lc-admin__toolbar">
        <div className="lc-admin__filter">
          <label htmlFor="admin-orders-status">Estado da encomenda</label>
          <select
            id="admin-orders-status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {ORDER_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="lc-admin__filter">
          <label htmlFor="admin-orders-payment">Pagamento</label>
          <select
            id="admin-orders-payment"
            value={paymentStatus}
            onChange={(event) => setPaymentStatus(event.target.value)}
          >
            {PAYMENT_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <Button variant="secondary" size="sm" onClick={retry}>
          Actualizar
        </Button>
      </div>

      {error && (
        <div className="lc-admin__banner lc-admin__banner--danger" role="alert">
          <p>{error}</p>
          <Button variant="secondary" size="sm" onClick={retry}>
            Tentar novamente
          </Button>
        </div>
      )}

      {orders === null && !error && (
        <div className="lc-admin__state" role="status">
          <Spinner />
          <p>A carregar encomendas…</p>
        </div>
      )}

      {orders !== null && orders.length === 0 && (
        <p className="lc-admin__empty">
          Não há encomendas com estes filtros. Mudar os filtros mostra o resto do histórico.
        </p>
      )}

      {orders !== null && orders.length > 0 && (
        <ul className="lc-admin__list">
          {orders.map((order) => {
            const orderState = orderStatusOf(order.status);
            const payment = paymentStatusOf(order.paymentStatus);
            return (
              <li key={order.number}>
                <Card elevation="flat" padding="md" className="lc-admin__row">
                  <div className="lc-admin__row-main">
                    <span className="lc-admin__row-title">
                      <Link className="lc-admin__row-link" to={`/admin/encomendas/${order.number}`}>
                        {order.number}
                      </Link>
                    </span>
                    <span className="lc-admin__row-meta">
                      {formatInstant(order.createdAt)} · {order.contactName} · {order.itemCount} artigo(s) ·{' '}
                      {order.fulfillment === 'PICKUP' ? 'Levantamento' : 'Entrega'}
                    </span>
                  </div>
                  <div className="lc-admin__row-side">
                    <span className="lc-admin__badges">
                      <Badge tone={orderState.tone}>{orderState.label}</Badge>
                      {payment && <Badge tone={payment.tone}>Pagamento: {payment.label}</Badge>}
                    </span>
                    <span className="lc-admin__amount">{formatKz(order.total)}</span>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
