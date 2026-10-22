import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError, cancelOrder, fetchOrder, type OrderView } from '../lib/api';
import { formatInstant, orderStatusOf, paymentStatusOf } from '../lib/orderStatus';
import { formatKz } from '../lib/money';
import { useSession } from '../lib/session';
import { Badge } from '../components/ui/Badge';
import { Button, ButtonLink } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import './account.css';

const FULFILLMENT_LABELS: Record<string, string> = {
  PICKUP: 'Levantamento na loja',
  DELIVERY: 'Entrega ao domicílio',
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  ON_DELIVERY: 'Pagamento na entrega ou levantamento',
  IBAN_TRANSFER: 'Transferência IBAN',
  MULTICAIXA_EXPRESS: 'Multicaixa Express',
};

/**
 * Detalhe de uma encomenda (fase 4/5): snapshot do que foi vendido, estado da
 * encomenda e do pagamento, e cancelamento enquanto ainda é possível
 * (decisão #7 — depois de confirmada, fala com a loja).
 */
export function OrderDetailPage() {
  const { number } = useParams<{ number: string }>();
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();

  const [order, setOrder] = useState<OrderView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const retry = useCallback(() => {
    setError(null);
    setNotFound(false);
    setOrder(null);
    setReloadKey((key) => key + 1);
  }, []);

  useEffect(() => {
    if (session.kind !== 'authenticated' || !number) return;
    const controller = new AbortController();
    setNotFound(false);
    fetchOrder(number, controller.signal)
      .then((result) => setOrder(result))
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        if (caught instanceof ApiError && caught.status === 404) {
          setNotFound(true);
          return;
        }
        setError(
          caught instanceof ApiError
            ? caught.message
            : 'Não foi possível carregar a encomenda. Tente novamente.',
        );
      });
    return () => controller.abort();
  }, [session.kind, number, reloadKey]);

  async function handleCancel() {
    if (!number) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const updated = await cancelOrder(number);
      setOrder(updated);
      setConfirmingCancel(false);
    } catch (caught) {
      setCancelError(
        caught instanceof ApiError
          ? caught.message
          : 'Não foi possível cancelar. Tente novamente.',
      );
      setConfirmingCancel(false);
    } finally {
      setCancelling(false);
    }
  }

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
          <h1 className="lc-orders__title">Encomenda</h1>
          <p className="lc-orders__lead">Entre para ver os detalhes das suas encomendas.</p>
        </header>
        <div className="lc-orders__signin">
          <Button size="lg" onClick={() => navigate('/entrar', { state: { from: location.pathname } })}>
            Entrar
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

  if (notFound) {
    return (
      <div className="lc-container lc-page lc-orders">
        <header className="lc-orders__head">
          <hr className="lc-ornament" />
          <h1 className="lc-orders__title">Encomenda não encontrada</h1>
          <p className="lc-orders__lead">
            Esta encomenda não existe ou não pertence à sua conta.
          </p>
        </header>
        <ButtonLink to="/conta/encomendas">← Voltar às minhas encomendas</ButtonLink>
      </div>
    );
  }

  if (error && order === null) {
    return (
      <div className="lc-container lc-page lc-orders">
        <header className="lc-orders__head">
          <hr className="lc-ornament" />
          <h1 className="lc-orders__title">Encomenda {number}</h1>
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

  if (order === null) {
    return (
      <div className="lc-container lc-page lc-orders__state" role="status">
        <Spinner />
        <p>A carregar a encomenda…</p>
      </div>
    );
  }

  const status = orderStatusOf(order.status);
  const payment = paymentStatusOf(order.paymentStatus);
  const canCancel = order.status === 'RECEIVED';

  return (
    <div className="lc-container lc-page lc-orders">
      <header className="lc-orders__head">
        <p className="lc-orders__back">
          <Link to="/conta/encomendas">← As minhas encomendas</Link>
        </p>
        <hr className="lc-ornament" />
        <p className="lc-orders__detail-number">{order.number}</p>
        <div className="lc-orders__badges">
          <Badge tone={status.tone}>{status.label}</Badge>
          {payment && <Badge tone={payment.tone}>Pagamento: {payment.label}</Badge>}
        </div>
        <p className="lc-orders__lead">{status.description}</p>
        {payment && <p className="lc-orders__payment-note">{payment.description}</p>}
        <p className="lc-orders__date">
          Registada a {formatInstant(order.createdAt)} ·{' '}
          {FULFILLMENT_LABELS[order.fulfillment] ?? order.fulfillment} ·{' '}
          {PAYMENT_METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod}
        </p>
      </header>

      {cancelError && (
        <div className="lc-orders__banner lc-orders__banner--danger" role="alert">
          <p>{cancelError}</p>
        </div>
      )}

      <Card as="section" elevation="raised" padding="lg" className="lc-orders__items">
        <h2>Artigos</h2>
        <ul className="lc-orders__lines">
          {order.items.map((item, index) => (
            <li key={`${item.kind}-${index}`}>
              <span className="lc-orders__line-name">
                {item.name}
                {item.kind === 'CAKE' && item.summary.length > 0 && (
                  <span className="lc-orders__line-detail">{item.summary.join(' · ')}</span>
                )}
              </span>
              <span className="lc-orders__line-qty">×{item.quantity}</span>
              <span className="lc-orders__line-price">{formatKz(item.lineTotal)}</span>
            </li>
          ))}
        </ul>

        <dl className="lc-orders__totals">
          <div className="lc-orders__total-row">
            <dt>Subtotal</dt>
            <dd>{formatKz(order.subtotal)}</dd>
          </div>
          <div className="lc-orders__total-row">
            <dt>Entrega</dt>
            <dd>{order.deliveryFee === '0.00' ? 'A combinar com a loja' : formatKz(order.deliveryFee)}</dd>
          </div>
          {order.discountAmount !== '0.00' && (
            <div className="lc-orders__total-row">
              <dt>
                {order.discountLabel ?? 'Desconto'}
                {order.pointsSpent > 0 && ` (${order.pointsSpent} pontos usados)`}
              </dt>
              <dd>− {formatKz(order.discountAmount)}</dd>
            </div>
          )}
          <div className="lc-orders__total-row lc-orders__total-row--grand">
            <dt>Total</dt>
            <dd>{formatKz(order.total)}</dd>
          </div>
        </dl>
      </Card>

      <Card as="section" elevation="flat" padding="lg" className="lc-orders__details">
        <h2>Dados da encomenda</h2>
        <dl className="lc-orders__facts">
          <div>
            <dt>Quem recebe</dt>
            <dd>{order.contactName}</dd>
          </div>
          <div>
            <dt>Telefone</dt>
            <dd>{order.contactPhone}</dd>
          </div>
          {order.fulfillment === 'DELIVERY' && (order.addressLine1 || order.addressCity) && (
            <div>
              <dt>Morada de entrega</dt>
              <dd>
                {[order.addressLine1, order.addressLine2, order.addressCity, order.addressMunicipality]
                  .filter(Boolean)
                  .join(', ')}
              </dd>
            </div>
          )}
          {order.notes && (
            <div>
              <dt>Notas</dt>
              <dd>{order.notes}</dd>
            </div>
          )}
        </dl>
      </Card>

      <section className="lc-orders__actions" aria-label="Acções da encomenda">
        {canCancel && !confirmingCancel && (
          <Button variant="secondary" onClick={() => setConfirmingCancel(true)}>
            Cancelar encomenda
          </Button>
        )}
        {canCancel && confirmingCancel && (
          <div className="lc-orders__cancel-confirm" role="alertdialog" aria-label="Confirmar cancelamento">
            <p>Cancelar a encomenda {order.number}? Esta acção não pode ser desfeita.</p>
            <div className="lc-orders__cancel-buttons">
              <Button onClick={handleCancel} loading={cancelling}>
                Sim, cancelar
              </Button>
              <Button variant="secondary" onClick={() => setConfirmingCancel(false)} disabled={cancelling}>
                Não, manter
              </Button>
            </div>
          </div>
        )}
        {!canCancel && order.status !== 'CANCELLED' && (
          <p className="lc-orders__cancel-note">
            Para alterar ou cancelar esta encomenda, fale connosco pelo telefone ou contactos da loja.
          </p>
        )}
      </section>
    </div>
  );
}
