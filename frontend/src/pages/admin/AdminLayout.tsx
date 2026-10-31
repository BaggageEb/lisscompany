import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { useSession } from '../../lib/session';
import { can, hasAdminAccess, type Permission } from '../../lib/permissions';
import '../account.css';
import './admin.css';
import '../../components/admin/admin-ui.css';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  permission: Permission;
  end?: boolean;
}

const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Operação',
    items: [
      { to: '/admin', label: 'Resumo', icon: '◈', permission: 'DASHBOARD_VIEW', end: true },
      { to: '/admin/encomendas', label: 'Encomendas', icon: '❒', permission: 'ORDERS_VIEW' },
      { to: '/admin/pagamentos', label: 'Pagamentos', icon: '✦', permission: 'PAYMENTS_REVIEW' },
      { to: '/admin/clientes', label: 'Clientes', icon: '☺', permission: 'CUSTOMERS_VIEW' },
    ],
  },
  {
    title: 'Catálogo',
    items: [
      { to: '/admin/produtos', label: 'Bolos e produtos', icon: '❀', permission: 'CATALOG_MANAGE' },
      { to: '/admin/ingredientes', label: 'Cake Studio', icon: '✎', permission: 'CATALOG_MANAGE' },
      { to: '/admin/inventario', label: 'Stock', icon: '▤', permission: 'INVENTORY_MANAGE' },
    ],
  },
  {
    title: 'Clientes e vendas',
    items: [{ to: '/admin/fidelizacao', label: 'Fidelização', icon: '★', permission: 'LOYALTY_MANAGE' }],
  },
  {
    title: 'Loja',
    items: [
      { to: '/admin/definicoes', label: 'Definições', icon: '⚙', permission: 'SETTINGS_MANAGE' },
      { to: '/admin/equipa', label: 'Equipa e acessos', icon: '☷', permission: 'STAFF_MANAGE' },
      { to: '/admin/auditoria', label: 'Auditoria', icon: '☰', permission: 'AUDIT_VIEW' },
    ],
  },
];

/**
 * Sistema de gestão da loja.
 *
 * A autoridade é sempre o servidor: qualquer `/api/v1/admin/**` responde 403
 * a quem não tem a permissão. Aqui o menu só mostra as secções a que a conta
 * tem acesso, para não apresentar ecrãs que não vão funcionar.
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

  const user = session.user;
  if (!hasAdminAccess(user)) {
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

  const groups = GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => can(user, item.permission)),
  })).filter((group) => group.items.length > 0);

  // Quem não vê o «Resumo» entra directamente na primeira secção permitida.
  const first = groups[0]?.items[0];
  if (location.pathname === '/admin' && first && first.to !== '/admin') {
    return <Navigate to={first.to} replace />;
  }

  return (
    <div className="lc-adm">
      <aside className="lc-adm__side">
        <div className="lc-adm__brand">
          <strong>LISSCOMPANY</strong>
          <span>Gestão da loja</span>
        </div>
        <nav aria-label="Secções do painel" style={{ display: 'grid', gap: 'var(--lc-space-4)' }}>
          {groups.map((group) => (
            <div key={group.title}>
              <p className="lc-adm__group-title">{group.title}</p>
              <div className="lc-adm__nav">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) => `lc-adm__link${isActive ? ' lc-adm__link--active' : ''}`}
                  >
                    <span className="lc-adm__icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <p className="lc-adm__back">
          <Link to="/conta">← Área do cliente</Link>
        </p>
      </aside>
      <section className="lc-adm__main" aria-label="Conteúdo do painel">
        <Outlet />
      </section>
    </div>
  );
}
