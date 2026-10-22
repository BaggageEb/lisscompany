import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ApiError,
  postCartQuote,
  type CartQuote,
  type CartQuoteLine,
} from '../lib/api';
import {
  cartQuantity,
  cartTotal,
  buildQuoteRequest,
  getCart,
  removeCartLine,
  subscribeCart,
  updateCartQuantity,
  type Cart,
  type CartLine,
} from '../lib/cart';
import { formatKz } from '../lib/money';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import './cart.css';

/**
 * Carrinho de compras.
 *
 * As linhas vivem no `localStorage` como conveniência de navegação; aqui o
 * servidor é chamado para <strong>revalidar e repreçar o carrinho inteiro</strong>
 * antes de o checkout poder avançar. Preço, disponibilidade e validade das
 * criações de bolo são sempre decisões do backend — a UI apenas apresenta o
 * que foi confirmado e explica o que precisa de correção.
 */

const QUOTE_DEBOUNCE_MS = 350;

type QuoteState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; quote: CartQuote }
  | { kind: 'error'; message: string };

/**
 * O servidor responde primeiro as linhas de produto e depois as de bolo, mas o
 * carrinho pode tê-las intercaladas — por isso associamos cada resposta ao seu
 * índice pela mesma ordem em que pedimos.
 */
function matchQuoteLines(cart: Cart, quote: CartQuote): Map<number, CartQuoteLine> {
  const productIndexes: number[] = [];
  const cakeIndexes: number[] = [];
  cart.lines.forEach((line, index) => (line.kind === 'PRODUCT' ? productIndexes : cakeIndexes).push(index));

  const matched = new Map<number, CartQuoteLine>();
  let cursor = 0;
  for (const index of [...productIndexes, ...cakeIndexes]) {
    const response = quote.lines[cursor];
    cursor += 1;
    if (response) matched.set(index, response);
  }
  return matched;
}

function lineKey(line: CartLine, index: number): string {
  return line.kind === 'PRODUCT' ? `product-${line.productId}` : `cake-${index}`;
}

/** Subtotal local de uma linha, usando a aritmética inteira do store do carrinho. */
function localLineTotal(line: CartLine): string {
  return cartTotal({ lines: [line], updatedAt: null });
}

interface CartLineRowProps {
  line: CartLine;
  /** Resposta do servidor para esta linha; ausente enquanto não é confirmada. */
  quoteLine?: CartQuoteLine;
  onChangeQuantity: (quantity: number) => void;
  onRemove: () => void;
}

function CartLineRow({ line, quoteLine, onChangeQuantity, onRemove }: CartLineRowProps) {
  const unit = quoteLine?.unitPrice ?? line.unitPrice;
  const total = quoteLine ? quoteLine.lineTotal : localLineTotal(line);
  const priceChanged = quoteLine !== undefined && quoteLine.unitPrice !== line.unitPrice;
  const invalid = quoteLine !== undefined && !quoteLine.valid;
  const name = line.kind === 'CAKE' ? `${line.name} (personalizado)` : line.name;

  return (
    <div className="cart__line-inner">
      <div className="cart__thumb" aria-hidden="true">
        {line.kind === 'PRODUCT' && line.imageUrl ? (
          <img src={line.imageUrl} alt="" loading="lazy" />
        ) : (
          <span className="cart__thumb-letter">{line.name.charAt(0)}</span>
        )}
      </div>

      <div className="cart__line-body">
        <div className="cart__line-head">
          <h2 className="cart__line-name">{name}</h2>
          {line.kind === 'CAKE' && <Badge tone="gold">Cake Studio</Badge>}
          {invalid && <Badge tone="danger">Não confirmado</Badge>}
          {priceChanged && !invalid && <Badge tone="warning">Preço actualizado</Badge>}
        </div>

        {line.kind === 'CAKE' && line.summary.length > 0 && (
          <ul className="cart__chips">
            {line.summary.map((item) => (
              <li key={item} className="cart__chip">
                {item}
              </li>
            ))}
          </ul>
        )}

        {invalid && quoteLine && quoteLine.issues.length > 0 && (
          <ul className="cart__line-issues">
            {quoteLine.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}

        <div className="cart__line-foot">
          <div className="cart__qty" role="group" aria-label={`Quantidade de ${name}`}>
            <button
              type="button"
              className="cart__qty-btn"
              disabled={line.quantity <= 1}
              aria-label={`Diminuir quantidade de ${name}`}
              onClick={() => onChangeQuantity(line.quantity - 1)}
            >
              <span aria-hidden="true">−</span>
            </button>
            <span className="cart__qty-value" aria-live="polite">
              {line.quantity}
            </span>
            <button
              type="button"
              className="cart__qty-btn"
              aria-label={`Aumentar quantidade de ${name}`}
              onClick={() => onChangeQuantity(line.quantity + 1)}
            >
              <span aria-hidden="true">+</span>
            </button>
          </div>

          <p className="cart__unit">
            {priceChanged ? (
              <>
                <s>{formatKz(line.unitPrice)}</s>
                <span> → {formatKz(unit)}</span>
              </>
            ) : (
              formatKz(unit)
            )}
          </p>

          <button
            type="button"
            className="cart__remove"
            aria-label={`Remover ${name} do carrinho`}
            onClick={onRemove}
          >
            Remover
          </button>

          <p className="cart__line-total">{formatKz(total)}</p>
        </div>
      </div>
    </div>
  );
}

export function CartPage() {
  const cart = useSyncExternalStore(subscribeCart, getCart, getCart);
  const [quoteState, setQuoteState] = useState<QuoteState>({ kind: 'idle' });
  const [retryToken, setRetryToken] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    if (cart.lines.length === 0) {
      setQuoteState({ kind: 'idle' });
      return;
    }
    const controller = new AbortController();
    setQuoteState({ kind: 'loading' });
    const timer = window.setTimeout(() => {
      postCartQuote(buildQuoteRequest(cart), controller.signal)
        .then((quote) => setQuoteState({ kind: 'ready', quote }))
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setQuoteState({
            kind: 'error',
            message: error instanceof ApiError ? error.message : 'Não foi possível confirmar os preços com o servidor.',
          });
        });
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [cart, retryToken]);

  const quoteByIndex = useMemo(
    () => (quoteState.kind === 'ready' ? matchQuoteLines(cart, quoteState.quote) : new Map<number, CartQuoteLine>()),
    [cart, quoteState],
  );

  const issues = useMemo(() => {
    if (quoteState.kind !== 'ready') return [];
    const list = [...quoteState.quote.issues];
    cart.lines.forEach((line, index) => {
      const response = quoteByIndex.get(index);
      if (response && !response.valid) {
        const label = line.kind === 'CAKE' ? 'Bolo personalizado' : line.name;
        for (const issue of response.issues) list.push(`${label}: ${issue}`);
      }
    });
    return list;
  }, [cart, quoteByIndex, quoteState]);

  if (cart.lines.length === 0) {
    return (
      <div className="lc-container lc-page cart">
        <header className="cart__head">
          <hr className="lc-ornament" />
          <h1 className="cart__title">Carrinho</h1>
        </header>
        <div className="cart__empty" role="status">
          <p>O seu carrinho está vazio.</p>
          <p className="cart__empty-hint">
            Escolhe produtos prontos na loja ou monta o teu bolo no Cake Studio — juntamo-lo aqui e confirmamos o
            preço no servidor.
          </p>
          <div className="cart__empty-actions">
            <Button onClick={() => navigate('/loja')}>Ir para a loja</Button>
            <Button variant="secondary" onClick={() => navigate('/cake-studio')}>
              Montar um bolo
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const quote = quoteState.kind === 'ready' ? quoteState.quote : null;
  const localTotal = cartTotal(cart);
  const itemCount = cartQuantity(cart);
  const priceChanged = quote !== null && quote.total !== localTotal;
  const canCheckout = quote?.valid === true;
  const checkoutLabel = canCheckout
    ? 'Finalizar compra'
    : quoteState.kind === 'error'
      ? 'Sem confirmação do servidor'
      : issues.length > 0
        ? 'Corrija os problemas acima'
        : 'A confirmar preços…';

  return (
    <div className="lc-container lc-page cart">
      <header className="cart__head">
        <hr className="lc-ornament" />
        <h1 className="cart__title">Carrinho</h1>
        <p className="cart__lead">
          Os artigos abaixo guardam um preço <em>estimado</em> no seu navegador. Antes de avançar, o servidor volta a
          calcular cada linha com o catálogo actual — é esse valor que será cobrado.
        </p>
      </header>

      <div className="cart__layout">
        <div>
          <ul className="cart__lines">
            {cart.lines.map((line, index) => (
              <li key={lineKey(line, index)}>
                <Card as="article" elevation="flat" padding="md" className="cart__line">
                  <CartLineRow
                    line={line}
                    quoteLine={quoteByIndex.get(index)}
                    onChangeQuantity={(quantity) => updateCartQuantity(index, quantity)}
                    onRemove={() => removeCartLine(index)}
                  />
                </Card>
              </li>
            ))}
          </ul>

          <p className="cart__list-actions">
            <Link to="/loja">← Continuar a comprar</Link>
          </p>
        </div>

        <Card as="section" elevation="raised" padding="lg" className="cart__summary">
          <h2 className="cart__summary-title">Resumo</h2>

          {quoteState.kind === 'loading' && (
            <p className="cart__checking" role="status">
              <Spinner size="sm" /> A confirmar preços com o servidor…
            </p>
          )}

          {quoteState.kind === 'error' && (
            <div className="cart__banner cart__banner--danger" role="alert">
              <p>{quoteState.message}</p>
              <Button variant="secondary" size="sm" onClick={() => setRetryToken((token) => token + 1)}>
                Tentar novamente
              </Button>
            </div>
          )}

          {issues.length > 0 && (
            <div className="cart__banner cart__banner--danger" role="alert">
              <p className="cart__banner-title">O servidor não confirmou o carrinho:</p>
              <ul className="cart__issue-list">
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          )}

          {priceChanged && (
            <p className="cart__banner cart__banner--warning" role="status">
              Alguns preços mudaram desde que os artigos entraram no carrinho. Mostramos sempre o valor actual.
            </p>
          )}

          <dl className="cart__totals">
            <div className="cart__total-row">
              <dt>
                Subtotal estimado ({itemCount} {itemCount === 1 ? 'artigo' : 'artigos'})
              </dt>
              <dd>{formatKz(localTotal)}</dd>
            </div>
            <div className="cart__total-row cart__total-row--grand">
              <dt>Total confirmado pelo servidor</dt>
              <dd>{quote ? formatKz(quote.total) : '—'}</dd>
            </div>
          </dl>

          <Button size="lg" fullWidth disabled={!canCheckout} onClick={() => navigate('/checkout')}>
            {checkoutLabel}
          </Button>

          <p className="cart__summary-note">
            Nada é cobrado agora. No checkout o servidor confirma outra vez preço e disponibilidade de cada artigo
            antes de criar a encomenda.
          </p>
        </Card>
      </div>
    </div>
  );
}
