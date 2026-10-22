import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CakeGlass } from '../components/cakeStudio/CakeGlass';
import { OptionCard } from '../components/cakeStudio/OptionCard';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { ApiError, fetchCakeStudioOptions, postCakeQuote } from '../lib/api';
import { addCartLine, cartQuantity } from '../lib/cart';
import { estimateComposition } from '../lib/cakeStudio/pricing';
import { cakeStudioReducer, canReachStep, INITIAL_STATE } from '../lib/cakeStudio/state';
import type { CakeStudioAction, CakeStudioState } from '../lib/cakeStudio/state';
import type { CakeQuote, CakeStudioOptions, CakeStudioStep } from '../lib/cakeStudio/types';
import { isCompositionComplete, validateComposition } from '../lib/cakeStudio/validation';
import { formatKz } from '../lib/money';
import '../components/cakeStudio/cake-studio.css';

/**
 * LissCompany Cake Studio — configurador imersivo em seis passos fixos.
 *
 * O cliente vê o copo em corte a ser construído, orienta-se com uma
 * estimativa de preço imediata, e no passo final o **servidor** confirma
 * preço e validade da composição antes de ir para o carrinho. Nada do que o
 * cliente calcula é autoritativo.
 */

const STEPS: Array<{ n: CakeStudioStep; short: string; title: string; hint: string }> = [
  { n: 1, short: 'Massa', title: 'Escolhe a massa', hint: 'A massa escolhida entra nas duas camadas.' },
  { n: 2, short: '1º recheio', title: 'Primeiro recheio', hint: 'Escolhe o primeiro recheio do teu bolo.' },
  { n: 3, short: 'Massa ×2', title: 'Segunda camada de massa', hint: 'A segunda camada entra no copo com a mesma massa.' },
  { n: 4, short: '2º recheio', title: 'Segundo recheio', hint: 'Repete o primeiro ou escolhe outro — até dois tipos distintos.' },
  { n: 5, short: 'Extras', title: 'Personalização final', hint: 'Zero a três extras e a humidade do bolo.' },
  { n: 6, short: 'Revisão', title: 'Revisão e carrinho', hint: 'Confirma a composição e o preço final.' },
];

function stepMeta(step: CakeStudioStep): { title: string; hint: string } {
  const found = STEPS.find((s) => s.n === step) ?? STEPS[0];
  return { title: found.title, hint: found.hint };
}

type LoadState = 'loading' | 'ready' | 'error';
type QuoteState = 'idle' | 'loading' | 'ready' | 'error';

export function CakeStudioPage() {
  const navigate = useNavigate();

  const [options, setOptions] = useState<CakeStudioOptions | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string>('');
  const [reloadToken, setReloadToken] = useState(0);

  const [studio, setStudio] = useState<CakeStudioState>(INITIAL_STATE);
  const [quote, setQuote] = useState<CakeQuote | null>(null);
  const [quoteState, setQuoteState] = useState<QuoteState>('idle');
  const [quoteError, setQuoteError] = useState<string>('');
  const [quoteToken, setQuoteToken] = useState(0);
  const [cartCount, setCartCount] = useState(() => cartQuantity());

  /* --------------------------- Carregamento --------------------------- */

  useEffect(() => {
    const controller = new AbortController();
    setLoadState('loading');
    fetchCakeStudioOptions(controller.signal)
      .then((data) => {
        setOptions(data);
        setLoadState('ready');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof ApiError ? error.message : 'Erro inesperado ao carregar o Cake Studio.');
        setLoadState('error');
      });
    return () => controller.abort();
  }, [reloadToken]);

  /* ------------------------------ Estado ------------------------------- */

  const dispatch = useCallback(
    (action: CakeStudioAction) => {
      setStudio((current) => (options ? cakeStudioReducer(current, action, options) : current));
    },
    [options],
  );

  const composition = studio.composition;
  const estimate = useMemo(
    () => (options ? estimateComposition(composition, options) : null),
    [options, composition],
  );
  const issues = useMemo(
    () => (options ? validateComposition(composition, options) : []),
    [options, composition],
  );

  const selectedBase = options && composition.cakeBaseId
    ? options.cakeBases.find((o) => o.id === composition.cakeBaseId) ?? null
    : null;
  const selectedFilling1 = options && composition.firstFillingId
    ? options.fillings.find((o) => o.id === composition.firstFillingId) ?? null
    : null;
  const selectedFilling2 = options && composition.secondFillingId
    ? options.fillings.find((o) => o.id === composition.secondFillingId) ?? null
    : null;
  const selectedExtras = options
    ? composition.extraIds
        .map((id) => options.extras.find((o) => o.id === id))
        .filter((o): o is NonNullable<typeof o> => Boolean(o))
    : [];

  /* ----------------- Orçamento do servidor (passo 6) ------------------ */

  const complete = options ? isCompositionComplete(composition, options) : false;

  useEffect(() => {
    if (!options || studio.step !== 6 || !complete) {
      setQuote(null);
      setQuoteState('idle');
      return;
    }
    const controller = new AbortController();
    setQuoteState('loading');
    const timer = window.setTimeout(() => {
      postCakeQuote(
        {
          cakeBaseId: composition.cakeBaseId!,
          firstFillingId: composition.firstFillingId!,
          secondFillingId: composition.secondFillingId!,
          extraIds: composition.extraIds,
          moist: composition.moist,
        },
        controller.signal,
      )
        .then((result) => {
          setQuote(result);
          setQuoteState('ready');
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setQuoteError(
            error instanceof ApiError ? error.message : 'Não foi possível confirmar o preço. Tente novamente.',
          );
          setQuoteState('error');
        });
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // quoteToken permite «tentar novamente» after erro.
  }, [options, studio.step, complete, composition, quoteToken]);

  /* ------------------------------ Carrinho ----------------------------- */

  function handleAddToCart() {
    if (!options || !quote || !quote.valid) return;
    const summary = [
      `Massa ${selectedBase?.name ?? ''}`,
      `1º recheio: ${selectedFilling1?.name ?? ''}`,
      `2º recheio: ${selectedFilling2?.name ?? ''}`,
      ...selectedExtras.map((extra) => `Extra: ${extra.name}`),
      composition.moist ? 'Bolo molhado' : 'Bolo não molhado',
    ];
    addCartLine({
      kind: 'CAKE',
      name: options.baseProduct.name,
      summary,
      unitPrice: quote.total,
      quantity: 1,
      composition,
    });
    setCartCount(cartQuantity());
    navigate('/carrinho');
  }

  /* ------------------------------ Render ------------------------------- */

  if (loadState === 'loading') {
    return (
      <div className="lc-container lc-page studio studio--centered">
        <Spinner size="lg" />
        <p className="studio__loading-text">A carregar as opções do Cake Studio…</p>
      </div>
    );
  }

  if (loadState === 'error' || !options) {
    return (
      <div className="lc-container lc-page studio studio--centered">
        <h1 className="studio__title">LissCompany Cake Studio</h1>
        <p className="studio__error" role="alert">
          {loadError}
        </p>
        <Button variant="primary" onClick={() => setReloadToken((t) => t + 1)}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  const meta = stepMeta(studio.step);
  const canGoNext = canReachStep(studio, (studio.step + 1) as CakeStudioStep, options);
  const isLast = studio.step === 6;

  return (
    <div className="lc-container lc-page studio">
      <header className="studio__head">
        <p className="studio__kicker">LissCompany Cake Studio</p>
        <h1 className="studio__title">Monta o teu bolo no pote</h1>
        <p className="studio__subtitle">
          Seis passos, quatro camadas — massa, recheio, massa, recheio. O preço é calculado e confirmado pelo nosso
          servidor em cada etapa.
        </p>

        <ol className="studio__progress" aria-label="Progresso do configurador">
          {STEPS.map((step) => {
            const reached = canReachStep(studio, step.n, options);
            const current = studio.step === step.n;
            return (
              <li key={step.n} className="studio__progress-item">
                <button
                  type="button"
                  className={[
                    'studio__progress-btn',
                    current ? 'studio__progress-btn--current' : '',
                    reached && !current ? 'studio__progress-btn--reached' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  disabled={!reached}
                  aria-current={current ? 'step' : undefined}
                  onClick={() => dispatch({ type: 'GO_TO_STEP', step: step.n })}
                >
                  <span className="studio__progress-num" aria-hidden="true">
                    {step.n}
                  </span>
                  <span className="studio__progress-label">{step.short}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </header>

      <div className="studio__grid">
        <aside className="studio__visual" aria-label="Pré-visualização do bolo">
          <CakeGlass
            cakeBase={selectedBase}
            firstFilling={selectedFilling1}
            secondCake={studio.step >= 3}
            secondFilling={selectedFilling2}
            extras={selectedExtras}
            moist={composition.moist}
          />

          <div className="studio__price">
            <p className="studio__price-label">Estimativa</p>
            <ul className="studio__price-lines">
              {estimate?.lines.map((line, index) => (
                <li key={`${line.label}-${index}`}>
                  <span>{line.label}</span>
                  <span>{formatKz(line.amount)}</span>
                </li>
              ))}
              {composition.moist && (
                <li className="studio__price-note">
                  <span>Bolo molhado</span>
                  <span>não altera o preço</span>
                </li>
              )}
            </ul>
            <p className="studio__price-total">
              <span>Total estimado</span>
              <strong>{estimate ? formatKz(estimate.total) : '—'}</strong>
            </p>
            {isLast && quoteState === 'ready' && quote && (
              <p className={`studio__price-confirmed ${quote.valid ? '' : 'studio__price-confirmed--invalid'}`}>
                {quote.valid
                  ? `Confirmado pelo servidor: ${formatKz(quote.total)}`
                  : 'Composição a corrigir — verifique os avisos.'}
              </p>
            )}
            <p className="studio__price-disclaimer">Estimativa para orientação; o servidor confirma antes do carrinho.</p>
          </div>
        </aside>

        <section className="studio__panel" aria-labelledby="studio-step-title">
          <h2 id="studio-step-title" className="studio__panel-title">
            {meta.title}
          </h2>
          <p className="studio__panel-hint">{meta.hint}</p>

          {/* -------- Passo 1: massa -------- */}
          {studio.step === 1 && (
            <div className="studio__options" role="radiogroup" aria-label="Massa do bolo">
              {options.cakeBases.map((option) => (
                <OptionCard
                  key={option.id}
                  option={option}
                  kind="CAKE_BASE"
                  mode="radio"
                  name="cake-base"
                  checked={composition.cakeBaseId === option.id}
                  onSelect={(id) => dispatch({ type: 'SELECT_CAKE_BASE', id })}
                />
              ))}
            </div>
          )}

          {/* -------- Passo 2: 1º recheio -------- */}
          {studio.step === 2 && (
            <div className="studio__options" role="radiogroup" aria-label="Primeiro recheio">
              {options.fillings.map((option) => (
                <OptionCard
                  key={option.id}
                  option={option}
                  kind="FILLING"
                  mode="radio"
                  name="filling-1"
                  checked={composition.firstFillingId === option.id}
                  onSelect={(id) => dispatch({ type: 'SELECT_FILLING', slot: 1, id })}
                />
              ))}
            </div>
          )}

          {/* -------- Passo 3: 2ª camada de massa -------- */}
          {studio.step === 3 && (
            <div className="studio__second-layer">
              <p>
                A segunda camada de massa entra agora no copo com a <strong>mesma massa</strong> escolhida:
              </p>
              <p className="studio__second-layer-choice">
                <span
                  className="studio__swatch"
                  aria-hidden="true"
                  style={{ background: 'linear-gradient(145deg, #d9b98c, #c2a173)' }}
                />
                <strong>{selectedBase?.name}</strong>
              </p>
              <p className="studio__panel-note">
                O configurador não permite uma segunda variedade de massa — é assim que garantimos a consistência do
                bolo.
              </p>
            </div>
          )}

          {/* -------- Passo 4: 2º recheio -------- */}
          {studio.step === 4 && (
            <div className="studio__options" role="radiogroup" aria-label="Segundo recheio">
              {options.fillings.map((option) => {
                const isRepeat = composition.firstFillingId === option.id;
                return (
                  <OptionCard
                    key={option.id}
                    option={option}
                    kind="FILLING"
                    mode="radio"
                    name="filling-2"
                    checked={composition.secondFillingId === option.id}
                    badge={isRepeat ? 'repetir 1º' : undefined}
                    onSelect={(id) => dispatch({ type: 'SELECT_FILLING', slot: 2, id })}
                  />
                );
              })}
              <p className="studio__panel-note">
                Até dois recheios distintos no total — podem ser iguais ou diferentes.
              </p>
            </div>
          )}

          {/* -------- Passo 5: extras + humidade -------- */}
          {studio.step === 5 && (
            <div className="studio__custom">
              <fieldset className="studio__fieldset">
                <legend>Extras (zero a {options.rules.maxExtras})</legend>
                <div className="studio__options">
                  {options.extras.map((option) => (
                    <OptionCard
                      key={option.id}
                      option={option}
                      kind="EXTRA"
                      mode="checkbox"
                      name={`extra-${option.id}`}
                      checked={composition.extraIds.includes(option.id)}
                      disabled={
                        !composition.extraIds.includes(option.id) &&
                        composition.extraIds.length >= options.rules.maxExtras
                      }
                      onSelect={(id) => dispatch({ type: 'TOGGLE_EXTRA', id })}
                    />
                  ))}
                </div>
                <p className="studio__panel-note">
                  {composition.extraIds.length}/{options.rules.maxExtras} seleccionados.
                </p>
              </fieldset>

              <fieldset className="studio__fieldset">
                <legend>Humidade do bolo</legend>
                <div className="studio__moist">
                  <label className={`studio__moist-option ${!composition.moist ? 'studio__moist-option--on' : ''}`}>
                    <input
                      type="radio"
                      name="moist"
                      className="lc-visually-hidden"
                      checked={!composition.moist}
                      onChange={() => dispatch({ type: 'SET_MOIST', moist: false })}
                    />
                    Não molhado
                  </label>
                  <label className={`studio__moist-option ${composition.moist ? 'studio__moist-option--on' : ''}`}>
                    <input
                      type="radio"
                      name="moist"
                      className="lc-visually-hidden"
                      checked={composition.moist}
                      onChange={() => dispatch({ type: 'SET_MOIST', moist: true })}
                    />
                    Molhado
                  </label>
                </div>
                <p className="studio__panel-note">A opção molhado não altera o preço.</p>
              </fieldset>
            </div>
          )}

          {/* -------- Passo 6: revisão -------- */}
          {studio.step === 6 && (
            <div className="studio__review">
              <dl className="studio__review-list">
                <div>
                  <dt>Massa (2 camadas)</dt>
                  <dd>{selectedBase?.name}</dd>
                </div>
                <div>
                  <dt>1º recheio</dt>
                  <dd>{selectedFilling1?.name}</dd>
                </div>
                <div>
                  <dt>2º recheio</dt>
                  <dd>{selectedFilling2?.name}</dd>
                </div>
                <div>
                  <dt>Extras</dt>
                  <dd>{selectedExtras.length > 0 ? selectedExtras.map((e) => e.name).join(', ') : 'Sem extras'}</dd>
                </div>
                <div>
                  <dt>Humidade</dt>
                  <dd>{composition.moist ? 'Molhado' : 'Não molhado'}</dd>
                </div>
              </dl>

              <div className="studio__review-quote" aria-live="polite">
                {quoteState === 'idle' && complete === false && (
                  <p className="studio__warning">Faltam escolhas obrigatórias para calcular o preço.</p>
                )}
                {quoteState === 'loading' && (
                  <p className="studio__quote-loading">
                    <Spinner size="sm" /> A confirmar preço com o servidor…
                  </p>
                )}
                {quoteState === 'error' && (
                  <div className="studio__warning" role="alert">
                    <p>{quoteError}</p>
                    <Button size="sm" variant="secondary" onClick={() => setQuoteToken((t) => t + 1)}>
                      Tentar confirmar de novo
                    </Button>
                  </div>
                )}
                {quoteState === 'ready' && quote && quote.valid && (
                  <p className="studio__quote-total">
                    <span>Preço confirmado</span>
                    <strong>{formatKz(quote.total)}</strong>
                  </p>
                )}
                {quoteState === 'ready' && quote && !quote.valid && (
                  <ul className="studio__warning" role="alert">
                    {quote.issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                )}
              </div>

              {issues.length > 0 && (
                <ul className="studio__warning" role="alert">
                  {issues.map((issue) => (
                    <li key={`${issue.field}-${issue.message}`}>{issue.message}</li>
                  ))}
                </ul>
              )}

              <div className="studio__review-actions">
                <Button
                  size="lg"
                  onClick={handleAddToCart}
                  disabled={!quote || !quote.valid}
                  data-testid="add-to-cart"
                >
                  Adicionar ao carrinho · {quote?.valid ? formatKz(quote.total) : '—'}
                </Button>
                <p className="studio__panel-note">
                  A composição é revalidada no servidor outra vez no checkout.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>

      <footer className="studio__nav">
        <div className="studio__nav-left">
          <Button variant="ghost" disabled={studio.step === 1} onClick={() => dispatch({ type: 'BACK' })}>
            ← Voltar
          </Button>
          <span className="studio__cart-hint" aria-live="polite">
            Carrinho: {cartCount} {cartCount === 1 ? 'artigo' : 'artigos'}
          </span>
        </div>
        {!isLast && (
          <div className="studio__nav-right">
            {!canGoNext && studio.step !== 3 && (
              <span className="studio__nav-hint">{meta.hint}</span>
            )}
            <Button
              onClick={() => dispatch({ type: 'NEXT' })}
              disabled={!canGoNext}
              title={!canGoNext ? 'Complete as escolhas desta etapa para avançar' : undefined}
            >
              Continuar →
            </Button>
          </div>
        )}
      </footer>
    </div>
  );
}
