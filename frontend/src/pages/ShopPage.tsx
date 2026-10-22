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
    return category === 'all'
      ? state.products
      : state.products.filter((product) => product.categorySlug === category);
  }, [state, category]);

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
              {visible.map((product) => (
                <li key={product.id}>
                  <Card as="article" elevation="interactive" className="shop__card">
                    <div className="shop__thumb" aria-hidden="true">
                      {product.imageUrl ? (
                        <img src={product.imageUrl} alt="" loading="lazy" />
                      ) : (
                        <span className="shop__thumb-letter">{product.name.charAt(0)}</span>
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
                      <Link className="shop__link" to={`/loja/${product.slug}`}>
                        Ver detalhe
                        <span aria-hidden="true"> →</span>
                      </Link>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
