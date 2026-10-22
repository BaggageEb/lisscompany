import { useEffect, useState } from 'react';
import { ButtonLink } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { fetchHealth, ApiError } from '../lib/api';
import './home.css';

type ApiState =
  | { kind: 'checking' }
  | { kind: 'online' }
  | { kind: 'offline'; message: string }
  | { kind: 'degraded' };

/**
 * Estado real da ligação ao backend (endpoint público de liveness).
 * Mostra os estados de carregamento/erro/sucesso exigidos pela UI.
 */
function useApiHealth(): ApiState {
  const [state, setState] = useState<ApiState>({ kind: 'checking' });

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth(controller.signal)
      .then((health) => {
        if (health.status === 'UP') setState({ kind: 'online' });
        else if (health.status === 'DEGRADED') setState({ kind: 'degraded' });
        else setState({ kind: 'offline', message: 'O serviço está indisponível.' });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof ApiError ? error.message : 'Erro inesperado ao contactar o servidor.';
        setState({ kind: 'offline', message });
      });
    return () => controller.abort();
  }, []);

  return state;
}

function ApiStatusBadge() {
  const state = useApiHealth();

  if (state.kind === 'checking') {
    return (
      <span className="home__status">
        <Spinner size="sm" /> A verificar ligação à loja…
      </span>
    );
  }
  if (state.kind === 'online') {
    return <Badge tone="success">Loja online</Badge>;
  }
  if (state.kind === 'degraded') {
    return <Badge tone="warning">Serviço degradado</Badge>;
  }
  return (
    <span className="home__status home__status--error">
      <Badge tone="danger">Servidor em manutenção</Badge>
      <span className="home__status-msg">{state.message}</span>
    </span>
  );
}

const BENEFITS = [
  {
    title: 'Feito à tua medida',
    text: 'Escolhe massa, recheios e extras no Cake Studio e vê o bolo a ganhar forma, camada a camada.',
  },
  {
    title: 'Preço claro, sem surpresas',
    text: 'Cada escolha actualiza a estimativa na hora. O valor final é confirmado pela loja antes de cobrarmos.',
  },
  {
    title: 'Entrega em Luanda ou levantamento',
    text: 'Escolhe a modalidade que te convém no momento da encomenda.',
  },
  {
    title: 'Recompensas a sério',
    text: 'Acumula pontos em cada compra paga e usa pontos ou recompensas no checkout — com valores confirmados pelo servidor.',
  },
];

export function HomePage() {
  return (
    <div className="home">
      {/* ---------- Hero ---------- */}
      <section className="home__hero" aria-labelledby="home-hero-title">
        <div className="lc-container home__hero-inner">
          <p className="home__hero-kicker">Confeitaria premium · Luanda</p>
          <hr className="lc-ornament home__hero-ornament" />
          <h1 id="home-hero-title" className="home__hero-title">
            O teu bolo no pote,
            <span className="home__hero-accent"> construído camada a camada</span>
          </h1>
          <p className="home__hero-text">
            Massas fofas, recheios irresistíveis e extras à tua escolha — monta a combinação perfeita no
            <strong> LissCompany Cake Studio</strong> e acompanha o preço desde o primeiro ingrediente.
          </p>
          <div className="home__hero-actions">
            <ButtonLink to="/cake-studio" size="lg" variant="gold">
              Abrir o Cake Studio
            </ButtonLink>
            <ButtonLink to="/loja" size="lg" variant="secondary">
              Ver a loja
            </ButtonLink>
          </div>
          <div className="home__hero-status">
            <ApiStatusBadge />
          </div>
        </div>
      </section>

      {/* ---------- Cake Studio destaque ---------- */}
      <section className="lc-container home__section" aria-labelledby="home-studio-title">
        <div className="home__split">
          <div>
            <hr className="lc-ornament" />
            <h2 id="home-studio-title">LissCompany Cake Studio</h2>
            <p>
              Do fundo do copo ao topo: escolhes a massa, o primeiro recheio, a segunda camada de massa e o segundo
              recheio. Depois, extras, humidade e revisão final. Podes recuar a qualquer momento sem perderes as
              escolhas.
            </p>
            <ul className="home__steps">
              <li>
                <span className="home__step-num">1</span> Massa
              </li>
              <li>
                <span className="home__step-num">2</span> Primeiro recheio
              </li>
              <li>
                <span className="home__step-num">3</span> Segunda camada de massa
              </li>
              <li>
                <span className="home__step-num">4</span> Segundo recheio
              </li>
              <li>
                <span className="home__step-num">5</span> Extras e humidade
              </li>
              <li>
                <span className="home__step-num">6</span> Revisão e carrinho
              </li>
            </ul>
            <ButtonLink to="/cake-studio" variant="primary">
              Começar a criar
            </ButtonLink>
          </div>

          {/* Pré-visualização estática ilustrativa do copo em corte — a versão
              interactiva vive no Cake Studio (fase 3). */}
          <div className="home__preview" role="img" aria-label="Ilustração de um bolo no pote em camadas dentro de um copo transparente">
            <svg viewBox="0 0 200 260" className="home__preview-svg" aria-hidden="true">
              <defs>
                <linearGradient id="cupGlass" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#123d8d" stopOpacity="0.10" />
                  <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.55" />
                  <stop offset="1" stopColor="#123d8d" stopOpacity="0.16" />
                </linearGradient>
              </defs>
              <rect x="34" y="30" width="132" height="210" rx="14" fill="url(#cupGlass)" stroke="#123d8d" strokeOpacity="0.55" strokeWidth="2" />
              <rect x="34" y="30" width="132" height="16" rx="8" fill="#123d8d" fillOpacity="0.75" />
              <g>
                <rect x="44" y="56" width="112" height="26" rx="6" fill="#e6cf86" />
                <rect x="44" y="84" width="112" height="18" rx="6" fill="#b8952a" />
                <rect x="44" y="104" width="112" height="26" rx="6" fill="#f3e2bd" />
                <rect x="44" y="132" width="112" height="18" rx="6" fill="#8a5a10" />
                <rect x="44" y="152" width="112" height="26" rx="6" fill="#e6cf86" />
                <rect x="44" y="180" width="112" height="22" rx="6" fill="#fffdf8" />
                <rect x="44" y="204" width="112" height="26" rx="6" fill="#f3e2bd" />
              </g>
              <circle cx="100" cy="196" r="7" fill="#d4af37" />
            </svg>
          </div>
        </div>
      </section>

      {/* ---------- Benefícios ---------- */}
      <section className="home__section home__section--soft" aria-labelledby="home-benefits-title">
        <div className="lc-container">
          <hr className="lc-ornament" />
          <h2 id="home-benefits-title">Porquê comprar na LISSCOMPANY?</h2>
          <div className="home__grid">
            {BENEFITS.map((benefit) => (
              <Card key={benefit.title} elevation="flat" as="article">
                <h3 className="home__benefit-title">{benefit.title}</h3>
                <p className="home__benefit-text">{benefit.text}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Produtos em destaque (fase 2) ---------- */}
      <section className="lc-container home__section" aria-labelledby="home-featured-title">
        <hr className="lc-ornament" />
        <h2 id="home-featured-title">Produtos em destaque</h2>
        <Card elevation="flat" padding="lg">
          <p>
            O catálogo será publicado aqui assim que os produtos, fotografias e preços forem confirmados pela
            proprietária. Nenhum preço ou produto é apresentado sem dados reais.
          </p>
          <p style={{ marginTop: 'var(--lc-space-4)' }}>
            <ButtonLink to="/loja" variant="secondary">
              Ir à loja
            </ButtonLink>
          </p>
        </Card>
      </section>

      {/* ---------- Fidelização (fase 6 — viva) ---------- */}
      <section className="lc-container home__section" aria-labelledby="home-loyalty-title">
        <hr className="lc-ornament" />
        <h2 id="home-loyalty-title">Fidelização</h2>
        <Card elevation="flat" padding="lg">
          <p>
            Acompanha o teu saldo de pontos, vê os movimentos de cada encomenda paga e escolhe no checkout
            entre usar pontos ou uma recompensa. As regras (taxas, valores, condições) são definidas pela
            loja — nada é inventado: os valores vêm sempre do servidor.
          </p>
          <p style={{ marginTop: 'var(--lc-space-4)' }}>
            <ButtonLink to="/fidelizacao">Ver os meus pontos</ButtonLink>
          </p>
        </Card>
      </section>
    </div>
  );
}
