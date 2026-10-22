import { PagePlaceholder } from './PagePlaceholder';

export function ForgotPasswordPage() {
  return (
    <PagePlaceholder
      title="Recuperar palavra-passe"
      status="Por definir · canal de recuperação"
      description="Fluxo de recuperação com mensagem neutra (não revela existência de contas) e tokens de uso único."
      details={
        <ul>
          <li>Confirmação por canal a definir (e-mail ou SMS) — pendente de configuração</li>
          <li>Token expirável, de uso único e sem exposição em logs</li>
        </ul>
      }
    />
  );
}
