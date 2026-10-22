import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ApiError,
  fetchAdminOrderDetail,
  transitionAdminOrder,
  type AdminOrderDetail,
} from '../../lib/api';
import { formatKz } from '../../lib/money';
import { formatInstant, orderStatusOf, paymentStatusOf } from '../../lib/orderStatus';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Spinner } from '../../components/ui/Spinner';
import './admin.css';

/** Rótulos accionáveis por estado de destino (a máquina decide o que aparece). */
const TARGET_LABELS: Record<string, string> = {
  CONFIRMED: 'Confirmar encomenda',
  PREPARING: 'Iniciar preparação',
  READY: 'Marcar pronta',
  COMPLETED: 'Concluir entrega',
  CANCELLED: 'Cancelar encomenda',
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  ON_DELIVERY: 'Pagamento na entrega ou levantamento',
  IBAN_TRANSFER: 'Transferência IBAN',
  MULTICAIXA_EXPRESS: 'Multicaixa Express',
};

/**
 * Detalhe da encomenda no painel (fase 7): snapshot completo + os botões de
 * transição que o SERVIDOR diz serem possíveis. O servidor revalida sempre —
 * um pedido inválido continua a dar 409 com o motivo.
 */
export function AdminOrderDetailPage() {
  const { number } = useParams<{ number: string }>();
  const [detail, setDetail] = useState<AdminOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const retry = useCallback(() => {
    setError(null);
    setDetail(null);
    setReloadKey((key) => key + 1);
  }, []);

  useEffect(() => {
    if (!number) return;
    const controller = new AbortController();
    fetchAdminOrderDetail(number, controller.signal)
      .then((result) => {
        setDetail(result);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          caught instanceof ApiError
            ? caught.message
            : 'Não foi possível carregar a encomenda. Tente novamente.',
        );
      });
    return () => controller.abort();
  }, [number, reloadKey]);

  async function transition(target: string) {
    if (!number) return;
    setBusy(true);
    setError(null);
    try {
      await transitionAdminOrder(number, target, note);
      setNote('');
      setConfirmCancel(false);
      setReloadKey((key) => key + 1);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Não foi possível mudar o estado. Tente novamente.',
      );
      setConfirmCancel(false);
    } finally {
      setBusy(false);
    }
  }

  if (error && detail === null) {
    return (
      <div className="lc-admin__banner lc-admin__banner--danger" role="alert">
        <p>{error}</p>
        <Button variant="secondary" size="sm" onClick={retry}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (detail === null) {
    return (
      <div className="lc-admin__state" role="status">
        <Spinner />
        <p>A carregar a encomenda…</p>
      </div>
    );
  }

  const order = detail.order;
  const status = orderStatusOf(order.status);
  const payment = paymentStatusOf(order.paymentStatus);

  return (
    <>
      <p className="lc-orders__back">
        <Link to="/admin/encomendas">← Todas as encomendas</Link>
      </p>

      {error && (
        <div className="lc-admin__banner lc-admin__banner--danger" role="alert">
          <p>{error}</p>
        </div>
      )}

      <Card as="section" elevation="raised" padding="lg" className="lc-admin__section">
        <span className="lc-admin__badges" style={{ justifyContent: 'flex-start' }}>
          <Badge tone={status.tone}>{status.label}</Badge>
          {payment && <Badge tone={payment.tone}>Pagamento: {payment.label}</Badge>}
        </span>
        <h2 style={{ marginTop: 'var(--lc-space-3)' }}>{order.number}</h2>
        <p className="lc-admin__row-meta">Registada a {formatInstant(order.createdAt)}</p>

        <ul className="lc-admin__list" style={{ marginTop: 'var(--lc-space-4)' }}>
          {order.items.map((item, index) => (
            <li key={`${item.kind}-${index}`}>
              <div className="lc-admin__row">
                <span className="lc-admin__row-main">
                  <span>
                    {item.name} <span className="lc-admin__row-meta">×{item.quantity}</span>
                  </span>
                  {item.summary.length > 0 && (
                    <span className="lc-admin__row-meta">{item.summary.join(' · ')}</span>
                  )}
                </span>
                <span className="lc-admin__amount">{formatKz(item.lineTotal)}</span>
              </div>
            </li>
          ))}
        </ul>

        <dl className="lc-admin__totals">
          <div className="lc-admin__total-row">
            <dt>Subtotal</dt>
            <dd>{formatKz(order.subtotal)}</dd>
          </div>
          <div className="lc-admin__total-row">
            <dt>Entrega</dt>
            <dd>{formatKz(order.deliveryFee)}</dd>
          </div>
          {order.discountAmount !== '0.00' && (
            <div className="lc-admin__total-row">
              <dt>
                {order.discountLabel ?? 'Desconto'}
                {order.pointsSpent > 0 && ` (${order.pointsSpent} pontos)`}
              </dt>
              <dd>− {formatKz(order.discountAmount)}</dd>
            </div>
          )}
          <div className="lc-admin__total-row lc-admin__total-row--grand">
            <dt>Total</dt>
            <dd>{formatKz(order.total)}</dd>
          </div>
        </dl>
      </Card>

      <Card as="section" elevation="flat" padding="lg" className="lc-admin__section">
        <h2>Dados da encomenda</h2>
        <dl className="lc-admin__detail-facts">
          <div>
            <dt>Quem recebe</dt>
            <dd>{order.contactName}</dd>
          </div>
          <div>
            <dt>Telefone</dt>
            <dd>{order.contactPhone}</dd>
          </div>
          <div>
            <dt>Modalidade</dt>
            <dd>{order.fulfillment === 'PICKUP' ? 'Levantamento na loja' : 'Entrega ao domicílio'}</dd>
          </div>
          <div>
            <dt>Método de pagamento</dt>
            <dd>{PAYMENT_METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod}</dd>
          </div>
          {order.fulfillment === 'DELIVERY' && (order.addressLine1 || order.addressCity) && (
            <div>
              <dt>Morada</dt>
              <dd>
                {[order.addressLine1, order.addressLine2, order.addressCity, order.addressMunicipality]
                  .filter(Boolean)
                  .join(', ')}
              </dd>
            </div>
          )}
          {order.notes && (
            <div>
              <dt>Notas do cliente</dt>
              <dd>{order.notes}</dd>
            </div>
          )}
        </dl>
      </Card>

      <section className="lc-admin__section" aria-label="Transições de estado">
        <h2>Actualizar estado</h2>
        <p className="lc-admin__section-note">
          Só aparecem as transições que a máquina de estados permite; o servidor volta a validar cada
          pedido. Confirmar o pagamento faz-se na secção Pagamentos (isso baixa o stock).
        </p>

        <div className="lc-admin__field" style={{ marginBottom: 'var(--lc-space-4)' }}>
          <label htmlFor="admin-order-note">Nota da mudança (opcional)</label>
          <input
            id="admin-order-note"
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Ex.: cliente avisado por telefone."
          />
        </div>

        {detail.allowedTargets.length === 0 && (
          <p className="lc-admin__empty">Estado terminal — não há mais transições possíveis.</p>
        )}

        <div className="lc-admin__actions">
          {detail.allowedTargets
            .filter((target) => target !== 'CANCELLED')
            .map((target) => (
              <Button key={target} onClick={() => transition(target)} loading={busy} disabled={busy}>
                {TARGET_LABELS[target] ?? target}
              </Button>
            ))}

          {detail.allowedTargets.includes('CANCELLED') && !confirmCancel && (
            <Button
              variant="secondary"
              onClick={() => setConfirmCancel(true)}
              disabled={busy}
            >
              Cancelar encomenda
            </Button>
          )}

          {confirmCancel && (
            <span className="lc-admin__actions" role="alertdialog" aria-label="Confirmar cancelamento">
              <span>Cancelar {order.number}? Stock é devolvido e o pagamento é fechado.</span>
              <Button variant="danger" onClick={() => transition('CANCELLED')} loading={busy}>
                Sim, cancelar
              </Button>
              <Button variant="secondary" onClick={() => setConfirmCancel(false)} disabled={busy}>
                Não, manter
              </Button>
            </span>
          )}
        </div>
      </section>
    </>
  );
}
