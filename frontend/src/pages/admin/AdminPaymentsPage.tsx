import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, fetchAdminPayments, reviewPayment, type PaymentAdminView } from '../../lib/api';
import { formatKz } from '../../lib/money';
import { formatInstant, paymentStatusOf } from '../../lib/orderStatus';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Spinner } from '../../components/ui/Spinner';
import './admin.css';

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'PENDING', label: 'Por confirmar' },
  { value: 'UNDER_REVIEW', label: 'Em revisão' },
  { value: 'PAID', label: 'Pagos' },
  { value: 'FAILED', label: 'Não confirmados' },
  { value: 'REFUNDED', label: 'Reembolsados' },
];

const METHOD_LABELS: Record<string, string> = {
  ON_DELIVERY: 'Na entrega',
  IBAN_TRANSFER: 'Transferência IBAN',
  MULTICAIXA_EXPRESS: 'Multicaixa Express',
};

/** Chave estável por tentativa: repetir o mesmo pedido nunca duplica efeitos. */
function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `panel-review:${crypto.randomUUID()}`;
  }
  return `panel-review:${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Fila de pagamentos do painel (fase 7, decisões #4/#5): revisão manual —
 * confirmar (PAID) baixa o stock e confirma a encomenda; rejeitar (FAILED)
 * fecha o pagamento. A chave de idempotência é gerada aqui para o reenvio em
 * rede não duplicar efeitos.
 */
export function AdminPaymentsPage() {
  const [payments, setPayments] = useState<PaymentAdminView[] | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const retry = () => {
    setError(null);
    setSuccess(null);
    setPayments(null);
    setReloadKey((key) => key + 1);
  };

  useEffect(() => {
    const controller = new AbortController();
    fetchAdminPayments(status || undefined, controller.signal)
      .then((result) => {
        setPayments(result);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          caught instanceof ApiError
            ? caught.message
            : 'Não foi possível carregar os pagamentos. Tente novamente.',
        );
      });
    return () => controller.abort();
  }, [status, reloadKey]);

  async function review(orderNumber: string, target: 'PAID' | 'FAILED') {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const key = keys[orderNumber] ?? newIdempotencyKey();
    setKeys((current) => ({ ...current, [orderNumber]: key }));
    try {
      const updated = await reviewPayment(orderNumber, {
        target,
        note: note.trim() || undefined,
        idempotencyKey: key,
      });
      setSuccess(
        `Pagamento da encomenda ${orderNumber} actualizado para ${
          paymentStatusOf(updated.status)?.label ?? updated.status
        }.`,
      );
      setOpenRow(null);
      setNote('');
      setReloadKey((reload) => reload + 1);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Não foi possível rever o pagamento. Tente novamente.',
      );
      // Chave nova para a próxima tentativa (a anterior pode ter sido registada).
      setKeys((current) => ({ ...current, [orderNumber]: newIdempotencyKey() }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="lc-admin__toolbar">
        <div className="lc-admin__filter">
          <label htmlFor="admin-payments-status">Estado do pagamento</label>
          <select id="admin-payments-status" value={status} onChange={(event) => setStatus(event.target.value)}>
            {STATUS_FILTERS.map((option) => (
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

      <p className="lc-admin__section-note">
        Sem fornecedor automático (decisão #4): só uma conta autorizada confirma ou rejeita. Confirmar
        baixa o stock e confirma a encomenda; rejeitar fecha o pagamento sem cobrança.
      </p>

      {success && (
        <div className="lc-admin__banner lc-admin__banner--success" role="status">
          <p>{success}</p>
        </div>
      )}

      {error && (
        <div className="lc-admin__banner lc-admin__banner--danger" role="alert">
          <p>{error}</p>
          <Button variant="secondary" size="sm" onClick={retry}>
            Tentar novamente
          </Button>
        </div>
      )}

      {payments === null && !error && (
        <div className="lc-admin__state" role="status">
          <Spinner />
          <p>A carregar pagamentos…</p>
        </div>
      )}

      {payments !== null && payments.length === 0 && (
        <p className="lc-admin__empty">Não há pagamentos neste estado.</p>
      )}

      {payments !== null && payments.length > 0 && (
        <ul className="lc-admin__list">
          {payments.map((payment) => {
            const state = paymentStatusOf(payment.status);
            const reviewable = payment.status === 'PENDING' || payment.status === 'UNDER_REVIEW';
            return (
              <li key={payment.orderNumber}>
                <Card elevation="flat" padding="md">
                  <div className="lc-admin__row">
                    <div className="lc-admin__row-main">
                      <span className="lc-admin__row-title">
                        <Link className="lc-admin__row-link" to={`/admin/encomendas/${payment.orderNumber}`}>
                          {payment.orderNumber}
                        </Link>
                      </span>
                      <span className="lc-admin__row-meta">
                        {formatInstant(payment.createdAt)} · {payment.contactName} ·{' '}
                        {METHOD_LABELS[payment.method] ?? payment.method} · Encomenda:{' '}
                        {payment.orderStatus}
                      </span>
                      {payment.reviewNote && (
                        <span className="lc-admin__row-meta">Nota: {payment.reviewNote}</span>
                      )}
                    </div>
                    <div className="lc-admin__row-side">
                      <span className="lc-admin__badges">
                        {state && <Badge tone={state.tone}>{state.label}</Badge>}
                      </span>
                      <span className="lc-admin__amount">{formatKz(payment.amount)}</span>
                      {reviewable && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setOpenRow(openRow === payment.orderNumber ? null : payment.orderNumber);
                            setNote('');
                          }}
                        >
                          {openRow === payment.orderNumber ? 'Fechar' : 'Rever pagamento'}
                        </Button>
                      )}
                    </div>
                  </div>

                  {openRow === payment.orderNumber && (
                    <div className="lc-admin__inline-form">
                      <div className="lc-admin__field">
                        <label htmlFor={`review-note-${payment.orderNumber}`}>Nota da revisão (opcional)</label>
                        <input
                          id={`review-note-${payment.orderNumber}`}
                          maxLength={500}
                          value={note}
                          onChange={(event) => setNote(event.target.value)}
                          placeholder="Ex.: comprovativo conferido no Multicaixa."
                        />
                      </div>
                      <div className="lc-admin__actions">
                        <Button onClick={() => review(payment.orderNumber, 'PAID')} loading={busy} disabled={busy}>
                          Confirmar recebimento (pago)
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() => review(payment.orderNumber, 'FAILED')}
                          loading={busy}
                          disabled={busy}
                        >
                          Marcar não confirmado
                        </Button>
                      </div>
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
