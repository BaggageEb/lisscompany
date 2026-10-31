import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Spinner } from '../../components/ui/Spinner';
import { Notice, PageHead, StatCard, describeError } from '../../components/admin/AdminUi';
import { fetchAdminDashboard, type AdminDashboard } from '../../lib/api';
import { formatKz } from '../../lib/money';
import { formatInstant, orderStatusOf } from '../../lib/orderStatus';
import { useSession } from '../../lib/session';
import { can } from '../../lib/permissions';

/** Resumo da loja: números reais lidos do servidor (nenhum valor de demonstração). */
export function AdminDashboardPage() {
  const session = useSession();
  const user = session.kind === 'authenticated' ? session.user : null;
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchAdminDashboard(controller.signal)
      .then(setData)
      .catch((cause) => {
        if (!controller.signal.aborted) setError(describeError(cause));
      });
    return () => controller.abort();
  }, []);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) {
    return (
      <div role="status" className="lc-empty">
        <Spinner size="lg" />
        <p>A carregar o resumo…</p>
      </div>
    );
  }

  const toReview = data.paymentsToReview;
  return (
    <>
      <PageHead title="Resumo da loja" lead="O que precisa da sua atenção hoje e os números reais da loja." />

      <div className="lc-stats">
        <StatCard
          label="Encomendas novas"
          value={data.ordersReceived}
          hint="Por confirmar"
          to="/admin/encomendas"
          alert={data.ordersReceived > 0}
        />
        <StatCard label="Em preparação" value={data.ordersConfirmed + data.ordersPreparing} hint="Confirmadas e a preparar" to="/admin/encomendas" />
        <StatCard label="Prontas" value={data.ordersReady} hint="Para levantar ou entregar" to="/admin/encomendas" />
        <StatCard
          label="Pagamentos por validar"
          value={toReview}
          to="/admin/pagamentos"
          alert={toReview > 0}
          hint={toReview > 0 ? 'Aguardam a sua revisão' : 'Tudo em dia'}
        />
        <StatCard label="Vendas confirmadas" value={formatKz(data.confirmedSales)} hint={`Últimos 7 dias: ${formatKz(data.salesLast7Days)}`} />
        <StatCard label="Reembolsado" value={formatKz(data.refundedTotal)} />
        <StatCard label="Clientes" value={data.customers} to={can(user, 'CUSTOMERS_VIEW') ? '/admin/clientes' : undefined} />
        <StatCard label="Produtos activos" value={data.activeProducts} to={can(user, 'CATALOG_MANAGE') ? '/admin/produtos' : undefined} />
        <StatCard label="Pontos em circulação" value={data.loyaltyPointsOutstanding} hint={`${data.rewardsRedeemed} recompensa(s) resgatada(s)`} />
      </div>

      <div className="lc-grid-2">
        <section className="lc-panel" aria-labelledby="dash-recent">
          <h2 id="dash-recent">Últimas encomendas</h2>
          {data.recentOrders.length === 0 ? (
            <p className="lc-empty">Ainda não há encomendas.</p>
          ) : (
            <div className="lc-tablewrap">
              <table className="lc-table">
                <thead>
                  <tr>
                    <th>Nº</th>
                    <th>Cliente</th>
                    <th>Estado</th>
                    <th className="lc-table__num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentOrders.map((order) => {
                    const status = orderStatusOf(order.status);
                    return (
                      <tr key={order.number}>
                        <td>
                          <Link to={`/admin/encomendas/${order.number}`}>{order.number}</Link>
                          <div className="lc-stat__hint">{formatInstant(order.createdAt)}</div>
                        </td>
                        <td>{order.contactName}</td>
                        <td>
                          <Badge tone={status.tone}>{status.label}</Badge>
                        </td>
                        <td className="lc-table__num">{formatKz(order.total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="lc-panel" aria-labelledby="dash-alerts">
          <h2 id="dash-alerts">Alertas de stock</h2>
          {data.soldOutProducts + data.soldOutIngredients === 0 && data.lowStockProducts.length === 0 ? (
            <p className="lc-empty">Sem alertas de stock.</p>
          ) : (
            <ul>
              {data.soldOutProducts > 0 && <li>{data.soldOutProducts} produto(s) esgotado(s).</li>}
              {data.soldOutIngredients > 0 && <li>{data.soldOutIngredients} ingrediente(s)/extra(s) esgotado(s) no Cake Studio.</li>}
              {data.lowStockProducts.map((item) => (
                <li key={item.name}>
                  {item.name}: {item.qty} em stock
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
