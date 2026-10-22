import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { register, useSession } from '../lib/session';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import './account.css';

/**
 * Registo de conta de cliente (fase 4). O backend exige e-mail único e
 * palavra-passe de 8+ caracteres; os erros por campo vêm no envelope e são
 * mostrados junto de cada campo.
 */
export function RegisterPage() {
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
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
      await register({
        email,
        displayName,
        password,
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      });
      navigate(from, { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError({ message: caught.message, fieldErrors: caught.fieldErrors });
      } else {
        setError({ message: 'Não foi possível criar a conta. Tente novamente.', fieldErrors: {} });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="lc-container lc-page lc-auth">
      <header className="lc-auth__head">
        <hr className="lc-ornament" />
        <h1 className="lc-auth__title">Criar conta</h1>
        <p className="lc-auth__lead">
          A conta serve para finalizar encomendas e as encomendas ficam associadas a si.
        </p>
      </header>

      <Card as="section" elevation="raised" padding="lg" className="lc-auth__card">
        {error && (
          <div className="lc-auth__error" role="alert">
            <Badge tone="danger">Não foi possível criar a conta</Badge>
            <p>{error.message}</p>
          </div>
        )}

        <form className="lc-auth__form" onSubmit={handleSubmit} noValidate>
          <div className="lc-auth__field">
            <label htmlFor="register-name">Nome a mostrar</label>
            <input
              id="register-name"
              name="displayName"
              type="text"
              autoComplete="name"
              required
              minLength={2}
              maxLength={120}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              aria-invalid={Boolean(error?.fieldErrors.displayName)}
            />
            {error?.fieldErrors.displayName && (
              <p className="lc-auth__field-error">{error.fieldErrors.displayName}</p>
            )}
          </div>

          <div className="lc-auth__field">
            <label htmlFor="register-email">E-mail</label>
            <input
              id="register-email"
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
            <label htmlFor="register-phone">
              Telefone <span className="lc-auth__optional">(opcional — ajuda a contactar sobre a encomenda)</span>
            </label>
            <input
              id="register-phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              maxLength={30}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              aria-invalid={Boolean(error?.fieldErrors.phone)}
            />
            {error?.fieldErrors.phone && <p className="lc-auth__field-error">{error.fieldErrors.phone}</p>}
          </div>

          <div className="lc-auth__field">
            <label htmlFor="register-password">Palavra-passe</label>
            <input
              id="register-password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={72}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={Boolean(error?.fieldErrors.password)}
            />
            {error?.fieldErrors.password && <p className="lc-auth__field-error">{error.fieldErrors.password}</p>}
            <p className="lc-auth__hint">Mínimo de 8 caracteres.</p>
          </div>

          <Button type="submit" size="lg" fullWidth loading={submitting}>
            Criar conta
          </Button>
        </form>

        <p className="lc-auth__alt">
          Já tem conta? <Link to="/entrar">Entrar</Link>
        </p>
      </Card>
    </div>
  );
}
