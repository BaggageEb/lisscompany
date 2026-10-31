import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, resetPassword } from '../lib/api';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import './account.css';

/** Define a nova palavra-passe a partir do link de recuperação (token de uso único). */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = confirm.length > 0 && password !== confirm;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) return;
    setSubmitting(true);
    setError(null);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(Object.values(caught.fieldErrors)[0] ?? caught.message);
      } else {
        setError('Não foi possível redefinir a palavra-passe. Tente novamente.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="lc-container lc-page lc-auth">
      <header className="lc-auth__head">
        <hr className="lc-ornament" />
        <h1 className="lc-auth__title">Nova palavra-passe</h1>
      </header>
      <Card as="section" elevation="raised" padding="lg" className="lc-auth__card">
        {!token ? (
          <div role="alert">
            <Badge tone="danger">Link inválido</Badge>
            <p>
              Este link não está completo. <Link to="/recuperar-palavra-passe">Peça um novo</Link>.
            </p>
          </div>
        ) : done ? (
          <div role="status">
            <Badge tone="success">Palavra-passe alterada</Badge>
            <p>
              Já pode entrar com a nova palavra-passe. <Link to="/entrar">Entrar</Link>
            </p>
          </div>
        ) : (
          <form className="lc-auth__form" onSubmit={handleSubmit} noValidate>
            {error && (
              <div className="lc-auth__error" role="alert">
                <p>{error}</p>
              </div>
            )}
            <div className="lc-auth__field">
              <label htmlFor="reset-password">Nova palavra-passe</label>
              <input
                id="reset-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <div className="lc-auth__field">
              <label htmlFor="reset-confirm">Repetir palavra-passe</label>
              <input
                id="reset-confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                aria-invalid={mismatch}
              />
              {mismatch && <p className="lc-auth__field-error">As palavras-passe não coincidem.</p>}
            </div>
            <Button type="submit" size="lg" fullWidth loading={submitting} disabled={password.length < 8 || mismatch || confirm.length === 0}>
              Guardar palavra-passe
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
