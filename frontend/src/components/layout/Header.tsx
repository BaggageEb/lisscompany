import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { logout, useSession } from '../../lib/session';
import './header.css';

const NAV_LINKS = [
  { to: '/loja', label: 'Loja' },
  { to: '/cake-studio', label: 'Cake Studio' },
  { to: '/fidelizacao', label: 'Fidelização' },
  { to: '/contactos', label: 'Contactos' },
];

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const session = useSession();
  const navigate = useNavigate();
  // Primeiro nome só — o cabeçalho não precisa do nome completo.
  const firstName = session.kind === 'authenticated' ? session.user.displayName.trim().split(' ')[0] : '';

  async function handleLogout() {
    await logout();
    navigate('/');
  }

  const navItems = NAV_LINKS.map((link) => (
    <NavLink
      key={link.to}
      to={link.to}
      className={({ isActive }) => `lc-nav__link${isActive ? ' lc-nav__link--active' : ''}`}
      onClick={() => setMenuOpen(false)}
    >
      {link.label}
    </NavLink>
  ));

  return (
    <header className="lc-header">
      <div className="lc-container lc-header__inner">
        <Link to="/" className="lc-brand" aria-label="LISSCOMPANY — página inicial">
          <span className="lc-brand__name">LISSCOMPANY</span>
          <span className="lc-brand__rule" aria-hidden="true" />
          <span className="lc-brand__tagline">a little bit of everything</span>
        </Link>

        <nav className="lc-nav lc-nav--desktop" aria-label="Navegação principal">
          {navItems}
        </nav>

        <div className="lc-header__actions">
          {session.kind === 'authenticated' ? (
            <>
              {session.user.owner && (
                <Link to="/admin" className="lc-header__action">
                  Painel
                </Link>
              )}
              <Link to="/conta" className="lc-header__action">
                {firstName}
              </Link>
              <button type="button" className="lc-header__action lc-header__action--button" onClick={handleLogout}>
                Sair
              </button>
            </>
          ) : (
            <Link to="/entrar" className="lc-header__action">
              Entrar
            </Link>
          )}
          <Link to="/carrinho" className="lc-header__action lc-header__action--cart">
            Carrinho
          </Link>
          <button
            type="button"
            className="lc-header__menu-btn"
            aria-expanded={menuOpen}
            aria-controls="lc-mobile-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span aria-hidden="true">{menuOpen ? '✕' : '☰'}</span>
            <span className="lc-visually-hidden">{menuOpen ? 'Fechar menu' : 'Abrir menu'}</span>
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav id="lc-mobile-menu" className="lc-nav lc-nav--mobile" aria-label="Navegação principal (mobile)">
          <div className="lc-container lc-nav--mobile__inner">{navItems}</div>
        </nav>
      )}
    </header>
  );
}
