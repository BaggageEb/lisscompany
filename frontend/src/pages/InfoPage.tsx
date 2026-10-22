import { PagePlaceholder } from './PagePlaceholder';

export function InfoPage() {
  return (
    <PagePlaceholder
      title="Informações e políticas"
      status="Em construção · texto por aprovar"
      description="Entrega e levantamento, privacidade, termos, cancelamentos e reembolsos ficam aqui, com o texto aprovado pela proprietária e validado do ponto de vista legal."
      details={
        <ul>
          <li>Nenhuma política definitiva é inventada — o conteúdo será carregado após revisão</li>
          <li>Prazos de cancelamento e regras de reembolso permanecem por definir</li>
        </ul>
      }
    />
  );
}
