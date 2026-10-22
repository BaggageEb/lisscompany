import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import './account.css';

/**
 * Área do cliente (fase 4/5/6/7). Encomendas, fidelização, perfil e
 * segurança são secções vivas; o painel da loja aparece só a contas
 * autorizadas — nada de controlos que pareçam funcionais sem o ser.
 */
export function AccountPage() {
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
          <h1 className="lc-orders__title">Área do cliente</h1>
          <p className="lc-orders__lead">
            Entre para ver as suas encomendas, os seus pontos e as recompensas disponíveis.
          </p>
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

  return (
    <div className="lc-container lc-page lc-orders">
      <header className="lc-orders__head">
        <hr className="lc-ornament" />
        <h1 className="lc-orders__title">Área do cliente</h1>
        <p className="lc-orders__lead">
          Olá, {session.user.displayName.split(' ')[0]}. Aqui está tudo o que já comprou e o que
          ainda vem por fases.
        </p>
      </header>

      <ul className="lc-account__sections">
        <li>
          <Link to="/conta/encomendas" className="lc-account__section-link">
            <Card elevation="raised" padding="md" className="lc-account__section">
              <span className="lc-account__section-head">
                <h2>As minhas encomendas</h2>
                <Badge tone="success">Disponível</Badge>
              </span>
              <p>Histórico com detalhe, estados da encomenda e do pagamento, e cancelamento.</p>
            </Card>
          </Link>
        </li>
        <li>
          <Link to="/conta/perfil" className="lc-account__section-link">
            <Card elevation="raised" padding="md" className="lc-account__section">
              <span className="lc-account__section-head">
                <h2>Perfil e moradas</h2>
                <Badge tone="success">Disponível</Badge>
              </span>
              <p>Dados de contacto, moradas guardadas e marcação da predefinida — editáveis aqui.</p>
            </Card>
          </Link>
        </li>
        <li>
          <Link to="/fidelizacao" className="lc-account__section-link">
            <Card elevation="raised" padding="md" className="lc-account__section">
              <span className="lc-account__section-head">
                <h2>Pontos e recompensas</h2>
                <Badge tone="success">Disponível</Badge>
              </span>
              <p>
                Saldo de pontos, movimentos de cada encomenda e recompensas com as condições reais —
                configuradas pela loja, nunca inventadas.
              </p>
            </Card>
          </Link>
        </li>
        <li>
          <Link to="/conta/perfil" className="lc-account__section-link">
            <Card elevation="raised" padding="md" className="lc-account__section">
              <span className="lc-account__section-head">
                <h2>Segurança da conta</h2>
                <Badge tone="success">Disponível</Badge>
              </span>
              <p>Sessões activas com terminação remota e alteração de palavra-passe com confirmação da actual.</p>
            </Card>
          </Link>
        </li>
        {session.user.owner && (
          <li>
            <Link to="/admin" className="lc-account__section-link">
              <Card elevation="raised" padding="md" className="lc-account__section">
                <span className="lc-account__section-head">
                  <h2>Painel da loja</h2>
                  <Badge tone="success">Disponível</Badge>
                </span>
                <p>Encomendas, pagamentos, inventário e regras de fidelização — só para contas autorizadas.</p>
              </Card>
            </Link>
          </li>
        )}
      </ul>
    </div>
  );
}
