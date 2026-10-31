import { useEffect, useState } from 'react';
import { Input } from '../../components/ui/Input';
import { Spinner } from '../../components/ui/Spinner';
import { Notice, PageHead, describeError } from '../../components/admin/AdminUi';
import { fetchAdminAudit, type AuditEntry } from '../../lib/api';
import { formatInstant } from '../../lib/orderStatus';

/** Registo de auditoria (só leitura): quem fez o quê e quando. Nunca mostra dados bancários. */
export function AdminAuditPage() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchAdminAudit(query, controller.signal)
        .then((rows) => {
          setEntries(rows);
          setError(null);
        })
        .catch((cause) => {
          if (!controller.signal.aborted) setError(describeError(cause));
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return (
    <>
      <PageHead title="Auditoria" lead="Registo das acções sensíveis: encomendas, pagamentos, catálogo, definições e acessos." />
      {error && <Notice tone="error">{error}</Notice>}
      <div className="lc-toolbar">
        <Input label="Filtrar" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Acção, pessoa ou detalhe" />
      </div>
      {!entries ? (
        <div role="status" className="lc-empty">
          <Spinner size="lg" />
        </div>
      ) : entries.length === 0 ? (
        <p className="lc-empty">Sem registos.</p>
      ) : (
        <div className="lc-tablewrap">
          <table className="lc-table">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Quem</th>
                <th>Acção</th>
                <th>Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatInstant(entry.createdAt)}</td>
                  <td>{entry.actor ?? '—'}</td>
                  <td>
                    <code>{entry.action}</code>
                  </td>
                  <td>{entry.details ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
