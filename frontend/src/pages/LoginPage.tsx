import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { login, useSession } from '../lib/session';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import './account.css';

/**
 * Login do cliente (fase 4). A sessão é cookie do servidor; aqui tratamos os
 * erros do envelope (credenciais, conta bloqueada) e deixamos o CSRF para o
 * cliente de API.
 */
export function LoginPage() {
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; fieldErrors: Record<string, string> } | null>(null);

  useEffect(() => {
    if (session.kind === 'authenticated') navigate(from, { replace: true });
  }, [session.kind, from, navigate]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError({ message: caught.message, fieldErrors: caught.fieldErrors });
      } else {
        setError({ message: 'Não foi possível entrar. Tente novamente.', fieldErrors: {} });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="lc-container lc-page lc-auth">
      <header className="lc-auth__head">
        <hr className="lc-ornament" />
        <h1 className="lc-auth__title">Entrar</h1>
        <p className="lc-auth__lead">
          Aceda à sua conta para finalizar encomendas e acompanhar o que já comprou.
        </p>
      </header>

      <Card as="section" elevation="raised" padding="lg" className="lc-auth__card">
        {error && (
          <div className="lc-auth__error" role="alert">
            <Badge tone="danger">Não foi possível entrar</Badge>
            <p>{error.message}</p>
          </div>
        )}

        <form className="lc-auth__form" onSubmit={handleSubmit} noValidate>
          <div className="lc-auth__field">
            <label htmlFor="login-email">E-mail</label>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={Boolean(error?.fieldErrors.email)}
            />
            {error?.fieldErrors.email && <p className="lc-auth__field-error">{error.fieldErrors.email}</p>}
          </div>

          <div className="lc-auth__field">
            <label htmlFor="login-password">Palavra-passe</label>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={Boolean(error?.fieldErrors.password)}
            />
            {error?.fieldErrors.password && <p className="lc-auth__field-error">{error.fieldErrors.password}</p>}
          </div>

          <Button type="submit" size="lg" fullWidth loading={submitting}>
            Entrar
          </Button>
        </form>

        <p className="lc-auth__alt">
          Ainda não tem conta? <Link to="/registar">Criar conta</Link>
        </p>
      </Card>
    </div>
  );
}
