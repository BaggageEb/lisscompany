import { PagePlaceholder } from './PagePlaceholder';

export function ContactPage() {
  return (
    <PagePlaceholder
      title="Contactos"
      status="Por configurar · definições da loja"
      description="Os contactos oficiais, informações de entrega e levantamento serão apresentados a partir das definições configuradas pela proprietária — não apresentamos moradas, horários ou valores inventados."
      details={
        <ul>
          <li>Contactos comerciais configurados nas definições da loja (próximo bloco do painel)</li>
          <li>Zonas, tarifas e horários de entrega; local e instruções de levantamento</li>
        </ul>
      }
    />
  );
}
