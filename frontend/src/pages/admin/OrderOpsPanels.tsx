import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Notice, TextArea, describeError } from '../../components/admin/AdminUi';
import {
  addOrderNote,
  fetchOrderHistory,
  fetchOrderNotes,
  fetchOrderRefunds,
  refundOrderPayment,
  type OrderHistoryEntry,
  type OrderNote,
  type RefundEntry,
} from '../../lib/api';
import { formatKz } from '../../lib/money';
import { formatInstant } from '../../lib/orderStatus';
import { can } from '../../lib/permissions';
import { useSession } from '../../lib/session';
import '../../components/admin/admin-ui.css';

/** Notas operacionais, reembolsos e histórico de alterações de uma encomenda. */
export function OrderOpsPanels({
  orderNumber,
  paymentStatus,
  total,
  onChanged,
}: {
  orderNumber: string;
  paymentStatus: string | null;
  total: string;
  onChanged: () => void;
}) {
  const session = useSession();
  const user = session.kind === 'authenticated' ? session.user : null;
  const [notes, setNotes] = useState<OrderNote[]>([]);
  const [history, setHistory] = useState<OrderHistoryEntry[]>([]);
  const [refunds, setRefunds] = useState<RefundEntry[]>([]);
  const [noteText, setNoteText] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [n, h, r] = await Promise.allSettled([
      fetchOrderNotes(orderNumber),
      fetchOrderHistory(orderNumber),
      fetchOrderRefunds(orderNumber),
    ]);
    if (n.status === 'fulfilled' && Array.isArray(n.value)) setNotes(n.value);
    if (h.status === 'fulfilled' && Array.isArray(h.value)) setHistory(h.value);
    if (r.status === 'fulfilled' && Array.isArray(r.value)) setRefunds(r.value);
  }, [orderNumber]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitNote(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const next = await addOrderNote(orderNumber, noteText);
      if (Array.isArray(next)) setNotes(next);
      setNoteText('');
      void load();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function submitRefund(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await refundOrderPayment(orderNumber, { amount, reason });
      setDone('Reembolso registado. Os pontos ganhos com esta encomenda foram estornados proporcionalmente.');
      setAmount('');
      setReason('');
      await load();
      onChanged();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  const canRefund =
    can(user, 'PAYMENTS_REFUND') && (paymentStatus === 'PAID' || paymentStatus === 'PARTIALLY_REFUNDED');

  return (
    <>
      {error && <Notice tone="error">{error}</Notice>}
      {done && <Notice tone="ok">{done}</Notice>}

      <section className="lc-panel" aria-labelledby="ops-notes">
        <h2 id="ops-notes">Notas internas</h2>
        {can(user, 'ORDERS_MANAGE') && (
          <form className="lc-form" onSubmit={submitNote} noValidate>
            <TextArea label="Nova nota (só a equipa vê)" value={noteText} maxLength={1000} onChange={(e) => setNoteText(e.target.value)} />
            <div className="lc-form__actions">
              <Button type="submit" size="sm" loading={busy} disabled={noteText.trim().length < 2}>
                Guardar nota
              </Button>
            </div>
          </form>
        )}
        {notes.length === 0 ? (
          <p className="lc-empty">Sem notas.</p>
        ) : (
          <ul>
            {notes.map((note, index) => (
              <li key={`${note.createdAt}-${index}`}>
                <strong>{note.author ?? 'Equipa'}</strong> · {formatInstant(note.createdAt)} — {note.body}
              </li>
            ))}
          </ul>
        )}
      </section>

      {(canRefund || refunds.length > 0) && (
        <section className="lc-panel" aria-labelledby="ops-refund">
          <h2 id="ops-refund">Reembolsos</h2>
          {refunds.length > 0 && (
            <ul>
              {refunds.map((refund, index) => (
                <li key={`${refund.createdAt}-${index}`}>
                  {formatKz(refund.amount)} · {formatInstant(refund.createdAt)} — {refund.reason}
                </li>
              ))}
            </ul>
          )}
          {canRefund && (
            <form className="lc-form" onSubmit={submitRefund} noValidate>
              <div className="lc-form__row">
                <Input
                  label="Valor a reembolsar (Kz)"
                  inputMode="decimal"
                  value={amount}
                  hint={`Nunca excede o valor pago (encomenda de ${formatKz(total)}).`}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <Input label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              <div className="lc-form__actions">
                <Button type="submit" variant="danger" size="sm" loading={busy} disabled={!amount || reason.trim().length < 3}>
                  Registar reembolso
                </Button>
              </div>
            </form>
          )}
        </section>
      )}

      <section className="lc-panel" aria-labelledby="ops-history">
        <h2 id="ops-history">Histórico de alterações</h2>
        {history.length === 0 ? (
          <p className="lc-empty">Sem registos.</p>
        ) : (
          <div className="lc-tablewrap">
            <table className="lc-table">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Quem</th>
                  <th>Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry, index) => (
                  <tr key={`${entry.createdAt}-${index}`}>
                    <td>{formatInstant(entry.createdAt)}</td>
                    <td>{entry.actor ?? '—'}</td>
                    <td>{entry.details ?? entry.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
