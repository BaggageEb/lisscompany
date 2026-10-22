import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, fetchProduct, type ProductSummary } from '../lib/api';
import { addCartLine, cartQuantity } from '../lib/cart';
import { formatKz } from '../lib/money';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import './shop.css';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; product: ProductSummary }
  | { kind: 'error'; message: string; notFound?: boolean };

/**
 * Ficha de produto do catálogo. O preço e a disponibilidade vêm do backend;
 * a adição ao carrinho guarda um snapshot local que o checkout revalida.
 */
export function ProductDetailPage() {
  const { slug } = useParams();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [added, setAdded] = useState(false);
  const [cartCount, setCartCount] = useState(() => cartQuantity());

  useEffect(() => {
    if (!slug) return;
    const controller = new AbortController();
    setState({ kind: 'loading' });
    fetchProduct(slug, controller.signal)
      .then((product) => setState({ kind: 'ready', product }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const notFound = error instanceof ApiError && error.status === 404;
        setState({
          kind: 'error',
          notFound,
          message: error instanceof ApiError ? error.message : 'Erro inesperado ao carregar o produto.',
        });
      });
    return () => controller.abort();
  }, [slug, reloadToken]);

  function handleAdd(product: ProductSummary) {
    addCartLine({
      kind: 'PRODUCT',
      productId: product.id,
      slug: product.slug,
      name: product.name,
      unitPrice: product.basePrice,
      quantity: 1,
      imageUrl: product.imageUrl,
    });
    setCartCount(cartQuantity());
    setAdded(true);
  }

  if (state.kind === 'loading') {
    return (
      <div className="lc-container lc-page shop__state" role="status">
        <Spinner size="lg" />
        <p>A carregar o produto…</p>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="lc-container lc-page shop__state shop__state--error" role="alert">
        <Badge tone="danger">{state.notFound ? 'Produto não encontrado' : 'Erro ao carregar'}</Badge>
        <p>{state.message}</p>
        <div className="shop__detail-actions">
          {!state.notFound && (
            <Button variant="secondary" onClick={() => setReloadToken((t) => t + 1)}>
              Tentar novamente
            </Button>
          )}
          <Link to="/loja">← Voltar à loja</Link>
        </div>
      </div>
    );
  }

  const product = state.product;

  return (
    <div className="lc-container lc-page shop">
      <p className="shop__breadcrumb">
        <Link to="/loja">Loja</Link>
        <span aria-hidden="true"> / </span>
        <span>{product.categoryName}</span>
      </p>

      <div className="shop__detail">
        <div className="shop__thumb shop__detail-thumb" aria-hidden="true">
          {product.imageUrl ? (
            <img src={product.imageUrl} alt="" loading="lazy" />
          ) : (
            <span className="shop__thumb-letter">{product.name.charAt(0)}</span>
          )}
        </div>

        <Card as="section" elevation="raised" padding="lg" className="shop__detail-card">
          <p className="shop__category">{product.categoryName}</p>
          <h1 className="shop__detail-title">{product.name}</h1>
          <p className="shop__detail-desc">{product.description}</p>

          <div className="shop__detail-meta">
            <p className="shop__price shop__detail-price">{formatKz(product.basePrice)}</p>
            {product.available ? (
              <Badge tone="success">Disponível</Badge>
            ) : (
              <Badge tone="warning">Esgotado</Badge>
            )}
          </div>

          <div className="shop__detail-actions">
            <Button size="lg" disabled={!product.available} onClick={() => handleAdd(product)}>
              {added ? 'Adicionado ✓' : 'Adicionar ao carrinho'}
            </Button>
            <span className="shop__cart-hint" aria-live="polite">
              Carrinho: {cartCount} {cartCount === 1 ? 'artigo' : 'artigos'}
            </span>
          </div>

          <p className="shop__detail-note">
            O preço e a disponibilidade são confirmados pelo servidor no momento da encomenda.
          </p>
        </Card>
      </div>
    </div>
  );
}
