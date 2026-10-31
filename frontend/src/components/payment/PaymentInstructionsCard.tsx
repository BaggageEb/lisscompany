import { useEffect, useState, type FormEvent } from 'react';
import {
  ApiError,
  fetchOrderPayment,
  submitPaymentProof,
  type OrderPaymentView,
  type PaymentMethod,
} from '../../lib/api';
import { formatKz } from '../../lib/money';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

/**
 * Como pagar esta encomenda. Os dados bancários vêm do servidor (configurados
 * pela proprietária) e só o dono da encomenda os vê. Indicar a referência do
 * pagamento NÃO marca «pago»: a loja valida e confirma.
 */
export function PaymentInstructionsCard({
  orderNumber,
  method,
  paymentStatus,
}: {
  orderNumber: string;
  method: PaymentMethod;
  paymentStatus: string | null;
}) {
  const [view, setView] = useState<OrderPaymentView | null>(null);
  const [failed, setFailed] = useState(false);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchOrderPayment(orderNumber, controller.signal)
      .then(setView)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [orderNumber]);

  if (method === 'ON_DELIVERY' && !view?.instructions.note) return null;
  if (paymentStatus === 'PAID' || paymentStatus === 'REFUNDED' || paymentStatus === 'PARTIALLY_REFUNDED') return null;
  if (failed || !view) return null;

  const { instructions } = view;
  const configured = Boolean(instructions.iban || instructions.number || instructions.note);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await submitPaymentProof(orderNumber, reference.trim());
      setSent(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? Object.values(caught.fieldErrors)[0] ?? caught.message : 'Não foi possível enviar. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card as="section" elevation="raised" padding="lg" aria-labelledby="pay-instructions">
      <h2 id="pay-instructions">Como pagar</h2>
      {!configured ? (
        <p>A loja vai enviar-lhe os dados de pagamento no contacto que indicou. Valor a pagar: <strong>{formatKz(view.amount)}</strong>.</p>
      ) : (
        <dl className="lc-checkout__totals">
          <div className="lc-checkout__total-row">
            <dt>Valor a pagar</dt>
            <dd>{formatKz(view.amount)}</dd>
          </div>
          {instructions.holder && (
            <div className="lc-checkout__total-row">
              <dt>Titular</dt>
              <dd>{instructions.holder}</dd>
            </div>
          )}
          {instructions.iban && (
            <div className="lc-checkout__total-row">
              <dt>IBAN / NIB</dt>
              <dd>
                <code>{instructions.iban}</code>
              </dd>
            </div>
          )}
          {instructions.number && (
            <div className="lc-checkout__total-row">
              <dt>Multicaixa Express</dt>
              <dd>
                <code>{instructions.number}</code>
              </dd>
            </div>
          )}
          {instructions.note && (
            <div className="lc-checkout__total-row">
              <dt>Indicações</dt>
              <dd>{instructions.note}</dd>
            </div>
          )}
        </dl>
      )}
      <p className="lc-checkout__note">
        Use o número <strong>{orderNumber}</strong> como referência. A encomenda só avança depois de a loja confirmar o pagamento.
      </p>

      {method !== 'ON_DELIVERY' &&
        (sent || view.proofReference ? (
          <p role="status">
            <Badge tone="blue">Referência enviada</Badge> A loja vai validar o seu pagamento
            {view.proofReference ? ` (${view.proofReference})` : ''}.
          </p>
        ) : (
          <form onSubmit={submit} noValidate className="lc-checkout__field">
            <label htmlFor="proof-reference">Já pagou? Indique a referência da transferência</label>
            <input
              id="proof-reference"
              value={reference}
              maxLength={200}
              onChange={(event) => setReference(event.target.value)}
              placeholder="Ex.: referência ou últimos dígitos do comprovativo"
            />
            {error && <p className="lc-checkout__field-error">{error}</p>}
            <Button type="submit" size="sm" loading={busy} disabled={reference.trim().length < 3}>
              Enviar referência
            </Button>
          </form>
        ))}
    </Card>
  );
}
