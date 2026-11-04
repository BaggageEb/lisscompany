import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
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
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [added, setAdded] = useState(false);
  const [cartCount, setCartCount] = useState(() => cartQuantity());
  const [activeImage, setActiveImage] = useState<string | null>(null);

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
    // Bolo personalizado: nunca entra no carrinho sem passar pela configuração.
    if (product.customizable) {
      navigate('/cake-studio');
      return;
    }
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
        <div>
          <div className="shop__thumb shop__detail-thumb">
            {(activeImage ?? product.imageUrl) ? (
              <img src={(activeImage ?? product.imageUrl) as string} alt={`Fotografia de ${product.name}`} />
            ) : (
              <span className="shop__thumb-letter" aria-hidden="true">
                {product.name.charAt(0)}
              </span>
            )}
          </div>
          {product.gallery && product.gallery.length > 0 && (
            <ul className="shop__gallery" aria-label="Mais fotografias" style={{ display: 'flex', gap: '0.5rem', listStyle: 'none', padding: 0, marginTop: '0.75rem', flexWrap: 'wrap' }}>
              {[product.imageUrl, ...product.gallery].filter((url): url is string => Boolean(url)).filter((url, i, all) => all.indexOf(url) === i).map((url, index) => (
                <li key={url}>
                  <button
                    type="button"
                    onClick={() => setActiveImage(url)}
                    aria-label={`Ver foto ${index + 1} de ${product.name}`}
                    aria-pressed={(activeImage ?? product.imageUrl) === url}
                    style={{ padding: 0, border: '2px solid var(--lc-border)', borderRadius: 8, background: 'none', cursor: 'pointer' }}
                  >
                    <img src={url} alt="" width={72} height={72} style={{ objectFit: 'cover', display: 'block', borderRadius: 6 }} loading="lazy" />
                  </button>
                </li>
              ))}
            </ul>
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
            {product.available && product.stockQty != null && product.stockQty <= 5 && (
              <Badge tone="gold">Restam {product.stockQty}</Badge>
            )}
          </div>

          <div className="shop__detail-actions">
            <Button size="lg" disabled={!product.available} onClick={() => handleAdd(product)}>
              {product.customizable ? 'Personalizar no Cake Studio' : added ? 'Adicionado ✓' : 'Adicionar ao carrinho'}
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
