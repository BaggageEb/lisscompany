import { useEffect, useMemo, useState } from 'react';
import { ApiError, adjustStock, fetchAdminStock, fetchProducts, type ProductSummary, type StockView } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Spinner } from '../../components/ui/Spinner';
import './admin.css';

/**
 * Inventário do painel (fase 7, decisão #2): ver stock e fazer ajustes
 * manuais. A primeira entrada positiva de um produto CRIA a linha de
 * inventário (quantidade inicial); produtos sem linha não aparecem — são
 * ilimitados até a proprietária configurar. O servidor rejeita ajustes que
 * deixariam o stock livre abaixo das reservas activas.
 */
export function AdminInventoryPage() {
  const [stock, setStock] = useState<StockView[] | null>(null);
  const [catalog, setCatalog] = useState<ProductSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [delta, setDelta] = useState('');
  const [note, setNote] = useState('');
  const [newProductId, setNewProductId] = useState('');
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Produtos do catálogo ainda sem linha de inventário: é por aqui que a
  // primeira quantidade de um produto entra no painel (decisão #2).
  const unmanaged = useMemo(
    () => catalog.filter((product) => !stock?.some((item) => item.productId === product.id)),
    [catalog, stock],
  );

  const retry = () => {
    setError(null);
    setSuccess(null);
    setStock(null);
    setReloadKey((key) => key + 1);
  };

  useEffect(() => {
    const controller = new AbortController();
    fetchAdminStock(controller.signal)
      .then((result) => {
        setStock(result);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          caught instanceof ApiError
            ? caught.message
            : 'Não foi possível carregar o inventário. Tente novamente.',
        );
      });
    fetchProducts(controller.signal)
      .then(setCatalog)
      .catch(() => {
        // Sem catálogo visível não há select de novos produtos — a lista
        // existente continua a funcionar.
      });
    return () => controller.abort();
  }, [reloadKey]);

  async function submit(productId: string, productName: string) {
    const value = Number.parseInt(delta, 10);
    if (!Number.isFinite(value) || value === 0) {
      setError('O ajuste não pode ser zero: indique quantas unidades a somar ou a subtrair.');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await adjustStock(productId, { delta: value, note: note.trim() || undefined });
      setSuccess(
        `${productName}: ${updated.availableQty} ${updated.unitLabel} em stock após o ajuste.`,
      );
      setOpenRow(null);
      setDelta('');
      setNote('');
      setReloadKey((reload) => reload + 1);
    } catch (caught) {
      if (caught instanceof ApiError) {
        const fieldIssue = Object.values(caught.fieldErrors)[0];
        setError(fieldIssue ?? caught.message);
      } else {
        setError('Não foi possível guardar o ajuste. Tente novamente.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="lc-admin__toolbar">
        <Button variant="secondary" size="sm" onClick={retry}>
          Actualizar
        </Button>
      </div>

      <p className="lc-admin__section-note">
        Stock por produto gerido. A primeira entrada positiva cria a linha de inventário do produto;
        ajustes que ficassem abaixo das reservas de encomendas pendentes são recusados. Sem linha =
        produto ilimitado (não aparece aqui).
      </p>

      {success && (
        <div className="lc-admin__banner lc-admin__banner--success" role="status">
          <p>{success}</p>
        </div>
      )}

      {error && (
        <div className="lc-admin__banner lc-admin__banner--danger" role="alert">
          <p>{error}</p>
        </div>
      )}

      {stock === null && !error && (
        <div className="lc-admin__state" role="status">
          <Spinner />
          <p>A carregar stock…</p>
        </div>
      )}

      {stock !== null && stock.length === 0 && (
        <p className="lc-admin__empty">
          Nenhum produto tem linha de inventário — todos são ilimitados até configurar. A primeira
          quantidade entra pela secção seguinte, com a quantidade inicial do produto.
        </p>
      )}

      {stock !== null && stock.length > 0 && (
        <ul className="lc-admin__list">
          {stock.map((item) => (
            <li key={item.productId}>
              <Card elevation="flat" padding="md">
                <div className="lc-admin__row">
                  <div className="lc-admin__row-main">
                    <span className="lc-admin__row-title">{item.productName}</span>
                    <span className="lc-admin__row-meta">
                      Disponível: {item.availableQty} {item.unitLabel} · Reservado: {item.reservedQty} ·
                      Livre: {Math.max(item.availableQty - item.reservedQty, 0)} {item.unitLabel}
                    </span>
                  </div>
                  <div className="lc-admin__row-side">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setOpenRow(openRow === item.productId ? null : item.productId);
                        setDelta('');
                        setNote('');
                      }}
                    >
                      {openRow === item.productId ? 'Fechar' : 'Ajustar stock'}
                    </Button>
                  </div>
                </div>

                {openRow === item.productId && (
                  <div className="lc-admin__inline-form">
                    <div className="lc-admin__form-grid">
                      <div className="lc-admin__field">
                        <label htmlFor={`adjust-delta-${item.productId}`}>
                          Unidades (positivo repõe, negativo baixa)
                        </label>
                        <input
                          id={`adjust-delta-${item.productId}`}
                          type="number"
                          step={1}
                          value={delta}
                          onChange={(event) => setDelta(event.target.value)}
                          placeholder="Ex.: 20 ou -3"
                        />
                      </div>
                      <div className="lc-admin__field">
                        <label htmlFor={`adjust-note-${item.productId}`}>Nota (opcional)</label>
                        <input
                          id={`adjust-note-${item.productId}`}
                          maxLength={500}
                          value={note}
                          onChange={(event) => setNote(event.target.value)}
                          placeholder="Ex.: reconto do armazém."
                        />
                      </div>
                    </div>
                    <div className="lc-admin__actions">
                      <Button
                        onClick={() => submit(item.productId, item.productName)}
                        loading={busy}
                        disabled={busy}
                      >
                        Guardar ajuste
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {stock !== null && unmanaged.length > 0 && (
        <Card as="section" elevation="flat" padding="md" className="lc-admin__section">
          <h2>Adicionar produto ao inventário</h2>
          <p className="lc-admin__section-note">
            Estes produtos ainda não têm linha de stock (vendem sem limite). A primeira entrada positiva
            cria a quantidade inicial; depois pode ajustar na lista acima.
          </p>
          <div className="lc-admin__inline-form" style={{ borderTop: 'none', marginTop: 0, paddingTop: 0 }}>
            <div className="lc-admin__form-grid">
              <div className="lc-admin__field">
                <label htmlFor="admin-new-stock-product">Produto</label>
                <select
                  id="admin-new-stock-product"
                  value={newProductId}
                  onChange={(event) => setNewProductId(event.target.value)}
                >
                  <option value="">Escolher produto…</option>
                  {unmanaged.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="lc-admin__field">
                <label htmlFor="admin-new-stock-delta">Quantidade inicial</label>
                <input
                  id="admin-new-stock-delta"
                  type="number"
                  step={1}
                  min={1}
                  value={delta}
                  onChange={(event) => setDelta(event.target.value)}
                  placeholder="Ex.: 40"
                />
              </div>
              <div className="lc-admin__field">
                <label htmlFor="admin-new-stock-note">Nota (opcional)</label>
                <input
                  id="admin-new-stock-note"
                  maxLength={500}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Ex.: stock inicial do fornecedor."
                />
              </div>
            </div>
            <div className="lc-admin__actions">
              <Button
                onClick={() => {
                  const product = catalog.find((item) => item.id === newProductId);
                  if (!product) {
                    setError('Escolha o produto para criar a quantidade inicial.');
                    return;
                  }
                  setBusy(true);
                  setError(null);
                  setSuccess(null);
                  const value = Number.parseInt(delta, 10);
                  if (!Number.isFinite(value) || value <= 0) {
                    setError('A quantidade inicial deve ser um número positivo.');
                    setBusy(false);
                    return;
                  }
                  adjustStock(product.id, { delta: value, note: note.trim() || undefined })
                    .then((updated) => {
                      setSuccess(`${product.name}: ${updated.availableQty} ${updated.unitLabel} em stock.`);
                      setNewProductId('');
                      setDelta('');
                      setNote('');
                      setReloadKey((reload) => reload + 1);
                    })
                    .catch((caught: unknown) => {
                      if (caught instanceof ApiError) {
                        const fieldIssue = Object.values(caught.fieldErrors)[0];
                        setError(fieldIssue ?? caught.message);
                      } else {
                        setError('Não foi possível guardar a quantidade inicial.');
                      }
                    })
                    .finally(() => setBusy(false));
                }}
                loading={busy}
                disabled={busy}
              >
                Criar quantidade inicial
              </Button>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
