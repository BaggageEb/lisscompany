import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, fetchProducts, type ProductSummary } from '../lib/api';
import { formatKz } from '../lib/money';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import './shop.css';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; products: ProductSummary[] }
  | { kind: 'error'; message: string };

/** Catálogo real da loja — dados exclusivamente do backend, sem inventários. */
export function ShopPage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [category, setCategory] = useState<string>('all');
  const [reloadToken, setReloadToken] = useState(0);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'default' | 'price-asc' | 'price-desc' | 'name'>('default');
  const [pageCount, setPageCount] = useState(1);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    fetchProducts(controller.signal)
      .then((products) => setState({ kind: 'ready', products }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          kind: 'error',
          message: error instanceof ApiError ? error.message : 'Erro inesperado ao carregar o catálogo.',
        });
      });
    return () => controller.abort();
  }, [reloadToken]);

  const categories = useMemo(() => {
    if (state.kind !== 'ready') return [];
    const seen = new Map<string, string>();
    for (const product of state.products) {
      if (!seen.has(product.categorySlug)) seen.set(product.categorySlug, product.categoryName);
    }
    return [...seen.entries()].map(([slug, name]) => ({ slug, name }));
  }, [state]);

  const visible = useMemo(() => {
    if (state.kind !== 'ready') return [];
    const needle = query.trim().toLowerCase();
    const filtered = state.products.filter(
      (product) =>
        (category === 'all' || product.categorySlug === category) &&
        (!needle ||
          product.name.toLowerCase().includes(needle) ||
          product.description.toLowerCase().includes(needle)),
    );
    const sorted = [...filtered];
    if (sort === 'price-asc') sorted.sort((a, b) => Number(a.basePrice) - Number(b.basePrice));
    else if (sort === 'price-desc') sorted.sort((a, b) => Number(b.basePrice) - Number(a.basePrice));
    else if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name, 'pt'));
    return sorted;
  }, [state, category, query, sort]);

  const PAGE_SIZE = 12;
  const shown = visible.slice(0, pageCount * PAGE_SIZE);

  return (
    <div className="lc-container lc-page shop">
      <header className="shop__head">
        <hr className="lc-ornament" />
        <h1 className="shop__title">Loja</h1>
        <p className="shop__lead">
          Catálogo de produtos prontos da LissCompany. Cada preço é definido e confirmado pela loja — o valor final
          é sempre revalidado no servidor antes de qualquer encomenda.
        </p>
      </header>

      {state.kind === 'loading' && (
        <div className="shop__state" role="status">
          <Spinner size="lg" />
          <p>A carregar o catálogo…</p>
        </div>
      )}

      {state.kind === 'error' && (
        <div className="shop__state shop__state--error" role="alert">
          <Badge tone="danger">Catálogo indisponível</Badge>
          <p>{state.message}</p>
          <Button variant="secondary" onClick={() => setReloadToken((t) => t + 1)}>
            Tentar novamente
          </Button>
        </div>
      )}

      {state.kind === 'ready' && (
        <>
          {categories.length > 0 && (
            <div className="shop__filters" role="group" aria-label="Filtrar por categoria">
              <button
                type="button"
                className={`shop__filter${category === 'all' ? ' shop__filter--active' : ''}`}
                aria-pressed={category === 'all'}
                onClick={() => setCategory('all')}
              >
                Todos
              </button>
              {categories.map((entry) => (
                <button
                  key={entry.slug}
                  type="button"
                  className={`shop__filter${category === entry.slug ? ' shop__filter--active' : ''}`}
                  aria-pressed={category === entry.slug}
                  onClick={() => setCategory(entry.slug)}
                >
                  {entry.name}
                </button>
              ))}
            </div>
          )}

          <div className="shop__filters" role="search">
            <label className="lc-visually-hidden" htmlFor="shop-search">
              Pesquisar produtos
            </label>
            <input
              id="shop-search"
              type="search"
              placeholder="Pesquisar bolos e produtos…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPageCount(1);
              }}
              style={{ padding: '0.5rem 0.9rem', borderRadius: 999, border: '1px solid var(--lc-border-strong)', minWidth: '15rem' }}
            />
            <label className="lc-visually-hidden" htmlFor="shop-sort">
              Ordenar por
            </label>
            <select
              id="shop-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as typeof sort)}
              style={{ padding: '0.5rem 0.9rem', borderRadius: 999, border: '1px solid var(--lc-border-strong)' }}
            >
              <option value="default">Ordem da loja</option>
              <option value="price-asc">Preço: do mais baixo</option>
              <option value="price-desc">Preço: do mais alto</option>
              <option value="name">Nome (A–Z)</option>
            </select>
          </div>

          {visible.length === 0 ? (
            <div className="shop__state" role="status">
              <p>Nenhum produto disponível nesta categoria de momento.</p>
              {category !== 'all' && (
                <Button variant="ghost" onClick={() => setCategory('all')}>
                  Ver todos os produtos
                </Button>
              )}
            </div>
          ) : (
            <ul className="shop__grid">
              {shown.map((product) => (
                <li key={product.id}>
                  <Card as="article" elevation="interactive" className="shop__card">
                    <div className="shop__thumb">
                      {product.imageUrl ? (
                        <img src={product.imageUrl} alt={`Fotografia de ${product.name}`} loading="lazy" />
                      ) : (
                        <span className="shop__thumb-letter" aria-hidden="true">
                          {product.name.charAt(0)}
                        </span>
                      )}
                    </div>
                    <div className="shop__body">
                      <p className="shop__category">{product.categoryName}</p>
                      <h2 className="shop__name">
                        <Link to={`/loja/${product.slug}`}>{product.name}</Link>
                      </h2>
                      <p className="shop__desc">{product.description}</p>
                      <div className="shop__foot">
                        <p className="shop__price">{formatKz(product.basePrice)}</p>
                        {product.available ? (
                          <Badge tone="success">Disponível</Badge>
                        ) : (
                          <Badge tone="warning">Esgotado</Badge>
                        )}
                      </div>
                      <Link className="shop__link" to={product.customizable ? '/cake-studio' : `/loja/${product.slug}`}>
                        {product.customizable ? 'Personalizar no Cake Studio' : 'Ver detalhe'}
                        <span aria-hidden="true"> →</span>
                      </Link>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}

          {shown.length < visible.length && (
            <p className="shop__state">
              <Button variant="secondary" onClick={() => setPageCount((n) => n + 1)}>
                Mostrar mais ({visible.length - shown.length})
              </Button>
            </p>
          )}
        </>
      )}
    </div>
  );
}
