import { Link } from 'react-router-dom';
import './footer.css';

/**
 * Rodapé. Os contactos, morada e horários serão preenchidos a partir das
 * definições configuradas pela proprietária (fase 7) — por isso não são
 * apresentados dados inventados aqui.
 */
export function Footer() {
  return (
    <footer className="lc-footer">
      <div className="lc-container lc-footer__grid">
        <div className="lc-footer__brand">
          <span className="lc-footer__name">LISSCOMPANY</span>
          <span className="lc-footer__tagline">a little bit of everything</span>
          <p className="lc-footer__note">
            Bolos no pote artesanais, feitos à tua medida no Cake Studio.
          </p>
        </div>

        <nav className="lc-footer__col" aria-label="Rodapé — loja">
          <h2 className="lc-footer__heading">Loja</h2>
          <Link to="/loja">Produtos</Link>
          <Link to="/cake-studio">Cake Studio</Link>
          <Link to="/fidelizacao">Fidelização</Link>
        </nav>

        <nav className="lc-footer__col" aria-label="Rodapé — conta">
          <h2 className="lc-footer__heading">Conta</h2>
          <Link to="/entrar">Entrar</Link>
          <Link to="/registar">Criar conta</Link>
          <Link to="/conta/encomendas">As minhas encomendas</Link>
        </nav>

        <nav className="lc-footer__col" aria-label="Rodapé — informações">
          <h2 className="lc-footer__heading">Informações</h2>
          <Link to="/contactos">Contactos</Link>
          <Link to="/informacoes/entrega">Entrega e levantamento</Link>
          <Link to="/informacoes/politicas">Políticas</Link>
        </nav>
      </div>

      <div className="lc-container lc-footer__bottom">
        <p>© {new Date().getFullYear()} LISSCOMPANY. Todos os direitos reservados.</p>
        <p className="lc-footer__muted">
          Contactos, morada e horários serão publicados assim que confirmados pela proprietária.
        </p>
      </div>
    </footer>
  );
}
