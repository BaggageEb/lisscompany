import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, requestPasswordReset } from '../lib/api';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import './account.css';

/**
 * Pedido de recuperação de palavra-passe. A resposta é sempre a mesma
 * (nunca revela se o e-mail tem conta) e o link é de uso único e expira.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível enviar o pedido. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="lc-container lc-page lc-auth">
      <header className="lc-auth__head">
        <hr className="lc-ornament" />
        <h1 className="lc-auth__title">Recuperar palavra-passe</h1>
        <p className="lc-auth__lead">Indique o e-mail da sua conta e enviamos as instruções para escolher uma nova palavra-passe.</p>
      </header>
      <Card as="section" elevation="raised" padding="lg" className="lc-auth__card">
        {sent ? (
          <div role="status">
            <Badge tone="success">Pedido registado</Badge>
            <p>
              Se existir uma conta com esse e-mail, receberá as instruções para redefinir a palavra-passe. O link
              expira passado pouco tempo e só pode ser usado uma vez.
            </p>
            <p className="lc-auth__alt">
              <Link to="/entrar">Voltar a entrar</Link>
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
              <label htmlFor="forgot-email">E-mail</label>
              <input
                id="forgot-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <Button type="submit" size="lg" fullWidth loading={submitting} disabled={!email.includes('@')}>
              Enviar instruções
            </Button>
            <p className="lc-auth__alt">
              <Link to="/entrar">Voltar a entrar</Link>
            </p>
          </form>
        )}
      </Card>
    </div>
  );
}
