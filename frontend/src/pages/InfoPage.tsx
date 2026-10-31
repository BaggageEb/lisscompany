import { Link, useLocation } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { useStoreInfo } from '../lib/store';
import { PagePlaceholder } from './PagePlaceholder';

const SECTIONS: { slug: string; title: string; keys: string[] }[] = [
  { slug: 'termos', title: 'Termos e condições', keys: ['terms'] },
  { slug: 'privacidade', title: 'Política de privacidade', keys: ['privacy'] },
  { slug: 'cancelamentos', title: 'Cancelamentos e reembolsos', keys: ['cancellation', 'refunds'] },
  { slug: 'entrega', title: 'Entrega e levantamento', keys: ['delivery'] },
];

const KEY_TITLE: Record<string, string> = {
  terms: 'Termos e condições',
  privacy: 'Privacidade',
  cancellation: 'Cancelamentos',
  refunds: 'Reembolsos',
  delivery: 'Entrega',
};

/** Textos legais e informativos: exactamente o que a proprietária publicou nas definições. */
export function InfoPage() {
  const { pathname } = useLocation();
  const store = useStoreInfo();
  const slug = pathname.split('/').filter(Boolean)[1] ?? '';
  const section = SECTIONS.find((item) => item.slug === slug) ?? null;
  const policies = store?.settings.policies ?? {};
  const keys = section ? section.keys : Object.keys(KEY_TITLE);
  const blocks = keys.filter((key) => policies[key]);

  if (!store) {
    return (
      <div className="lc-container lc-page" role="status" style={{ paddingBlock: 'var(--lc-space-10)' }}>
        <p>A carregar…</p>
      </div>
    );
  }

  if (blocks.length === 0) {
    return (
      <PagePlaceholder
        title={section?.title ?? 'Informações e políticas'}
        status="Em construção · texto por aprovar"
        description="Este texto será publicado pela loja assim que estiver aprovado. Não apresentamos políticas inventadas."
      />
    );
  }

  return (
    <div className="lc-container lc-page" style={{ paddingBlock: 'var(--lc-space-10)', maxWidth: '48rem' }}>
      <hr className="lc-ornament" />
      <h1>{section?.title ?? 'Informações e políticas'}</h1>
      {blocks.map((key) => (
        <Card key={key} as="section" elevation="flat" padding="lg" style={{ marginBottom: '1.25rem' }}>
          {blocks.length > 1 && <h2>{KEY_TITLE[key]}</h2>}
          <div style={{ whiteSpace: 'pre-wrap' }}>{policies[key]}</div>
        </Card>
      ))}
      <p>
        <Link to="/">← Página inicial</Link>
      </p>
    </div>
  );
}
