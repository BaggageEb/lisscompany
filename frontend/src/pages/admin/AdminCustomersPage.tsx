import { useEffect, useMemo, useState } from 'react';
import { Input } from '../../components/ui/Input';
import { Spinner } from '../../components/ui/Spinner';
import { Notice, PageHead, describeError } from '../../components/admin/AdminUi';
import { fetchAdminCustomers, type AdminCustomer } from '../../lib/api';
import { formatKz } from '../../lib/money';
import { formatInstant } from '../../lib/orderStatus';

/** Clientes registados (só leitura): contacto, nº de encomendas, valor pago e pontos. */
export function AdminCustomersPage() {
  const [customers, setCustomers] = useState<AdminCustomer[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchAdminCustomers(controller.signal)
      .then(setCustomers)
      .catch((cause) => {
        if (!controller.signal.aborted) setError(describeError(cause));
      });
    return () => controller.abort();
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (customers ?? []).filter(
      (c) => !q || c.displayName.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || (c.phone ?? '').includes(q),
    );
  }, [customers, query]);

  return (
    <>
      <PageHead title="Clientes" lead="Quem já se registou na loja, quanto encomendou e os pontos acumulados." />
      {error && <Notice tone="error">{error}</Notice>}
      <div className="lc-toolbar">
        <Input label="Pesquisar" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nome, e-mail ou telefone" />
      </div>
      {!customers ? (
        <div role="status" className="lc-empty">
          <Spinner size="lg" />
        </div>
      ) : visible.length === 0 ? (
        <p className="lc-empty">Nenhum cliente encontrado.</p>
      ) : (
        <div className="lc-tablewrap">
          <table className="lc-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Contacto</th>
                <th className="lc-table__num">Encomendas</th>
                <th className="lc-table__num">Total pago</th>
                <th className="lc-table__num">Pontos</th>
                <th>Desde</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((customer) => (
                <tr key={customer.id}>
                  <td>
                    <strong>{customer.displayName}</strong>
                  </td>
                  <td>
                    {customer.email}
                    {customer.phone && <div className="lc-stat__hint">{customer.phone}</div>}
                  </td>
                  <td className="lc-table__num">{customer.orders}</td>
                  <td className="lc-table__num">{formatKz(customer.spent)}</td>
                  <td className="lc-table__num">{customer.points}</td>
                  <td>{formatInstant(customer.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
