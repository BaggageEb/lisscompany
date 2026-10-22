import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { useSession } from '../../lib/session';
import '../account.css';
import './admin.css';

const TABS = [
  { to: '/admin/encomendas', label: 'Encomendas' },
  { to: '/admin/pagamentos', label: 'Pagamentos' },
  { to: '/admin/inventario', label: 'Inventário' },
  { to: '/admin/fidelizacao', label: 'Fidelização' },
];

/**
 * Envoltória do painel (fase 7).
 *
 * A autoridade continua no servidor: qualquer `/api/v1/admin/**` responde 403
 * a contas não autorizadas, mesmo que a UI ache o contrário. Aqui a guarda só
 * evita mostrar um painel que não vai funcionar — e diz a verdade quando a
 * conta não tem permissão (sem fingir que a secção existe).
 */
export function AdminLayout() {
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();

  if (session.kind === 'loading') {
    return (
      <div className="lc-container lc-page lc-orders__state" role="status">
        <Spinner size="lg" />
        <p>A verificar a sessão…</p>
      </div>
    );
  }

  if (session.kind === 'anonymous') {
    return (
      <div className="lc-container lc-page lc-orders">
        <header className="lc-orders__head">
          <hr className="lc-ornament" />
          <h1 className="lc-orders__title">Painel da loja</h1>
          <p className="lc-orders__lead">Entre com a conta da loja para abrir o painel.</p>
        </header>
        <div className="lc-orders__signin">
          <Button size="lg" onClick={() => navigate('/entrar', { state: { from: location.pathname } })}>
            Entrar
          </Button>
          <p>
            Ainda não tem conta?{' '}
            <Link to="/registar" state={{ from: location.pathname }}>
              Criar conta
            </Link>
          </p>
        </div>
      </div>
    );
  }

  if (!session.user.owner) {
    return (
      <div className="lc-container lc-page lc-orders">
        <header className="lc-orders__head">
          <hr className="lc-ornament" />
          <h1 className="lc-orders__title">Painel da loja</h1>
        </header>
        <div className="lc-admin__forbidden" role="alert">
          <p>
            A sua conta não tem permissão para o painel. O acesso é gerido pela proprietária da loja —
            se precisa de o painel, fale connosco.
          </p>
          <ButtonLink to="/conta" variant="secondary">
            ← Área do cliente
          </ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <div className="lc-container lc-page lc-admin">
      <header className="lc-admin__head">
        <p className="lc-orders__back">
          <Link to="/conta">← Área do cliente</Link>
        </p>
        <hr className="lc-ornament" />
        <h1 className="lc-admin__title">Painel da loja</h1>
        <p className="lc-admin__lead">
          Encomendas, pagamentos, stock e regras de fidelização. Tudo é validado e registado no servidor —
          cada acção sensível fica na auditoria.
        </p>
      </header>

      <nav className="lc-admin__tabs" aria-label="Secções do painel">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) => `lc-admin__tab${isActive ? ' lc-admin__tab--active' : ''}`}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </div>
  );
}
