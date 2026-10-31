import { Link } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { formatKz } from '../lib/money';
import { useStoreInfo } from '../lib/store';
import { PagePlaceholder } from './PagePlaceholder';
import './placeholder.css';

const LABELS: [string, string][] = [
  ['phone', 'Telefone'],
  ['whatsapp', 'WhatsApp'],
  ['email', 'E-mail'],
  ['address', 'Morada'],
  ['hours', 'Horário'],
  ['instagram', 'Instagram'],
  ['facebook', 'Facebook'],
];

/** Contactos, levantamento e entrega — tudo vindo das definições da proprietária. */
export function ContactPage() {
  const store = useStoreInfo();
  const contacts = store?.settings.contacts ?? {};
  const rows = LABELS.filter(([key]) => contacts[key]);
  const pickup = store?.settings.pickup ?? {};
  const zones = store?.deliveryZones ?? [];

  if (store && rows.length === 0 && zones.length === 0 && !pickup.address) {
    return (
      <PagePlaceholder
        title="Contactos"
        status="Por configurar · definições da loja"
        description="Os contactos oficiais serão apresentados assim que a loja os configurar — não apresentamos moradas, horários ou valores inventados."
      />
    );
  }

  return (
    <div className="lc-container lc-page" style={{ paddingBlock: 'var(--lc-space-10)' }}>
      <hr className="lc-ornament" />
      <h1>Contactos</h1>
      {!store && <p role="status">A carregar…</p>}
      {rows.length > 0 && (
        <Card as="section" elevation="raised" padding="lg" aria-labelledby="contact-title">
          <h2 id="contact-title">Fale connosco</h2>
          <dl>
            {rows.map(([key, label]) => (
              <div key={key} style={{ display: 'flex', gap: '1rem', paddingBlock: '0.35rem' }}>
                <dt style={{ minWidth: '7rem', fontWeight: 600 }}>{label}</dt>
                <dd style={{ margin: 0 }}>{contacts[key]}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}
      {(pickup.address || pickup.hours || pickup.instructions) && (
        <Card as="section" elevation="flat" padding="lg" aria-labelledby="pickup-title" style={{ marginTop: '1.5rem' }}>
          <h2 id="pickup-title">Levantamento</h2>
          <p>{[pickup.address, pickup.hours, pickup.instructions].filter(Boolean).join(' · ')}</p>
        </Card>
      )}
      {zones.length > 0 && (
        <Card as="section" elevation="flat" padding="lg" aria-labelledby="delivery-title" style={{ marginTop: '1.5rem' }}>
          <h2 id="delivery-title">Entrega</h2>
          <ul>
            {zones.map((zone) => (
              <li key={zone.id}>
                <strong>{zone.name}</strong>: {formatKz(zone.fee)}
                {zone.freeOver ? ` (grátis a partir de ${formatKz(zone.freeOver)})` : ''}
                {zone.leadTime || zone.schedule ? ` · ${[zone.leadTime, zone.schedule].filter(Boolean).join(' · ')}` : ''}
              </li>
            ))}
          </ul>
          {store?.settings.deliveryNotes && <p>{store.settings.deliveryNotes}</p>}
        </Card>
      )}
      <p style={{ marginTop: '1.5rem' }}>
        <Link to="/loja">← Voltar à loja</Link>
      </p>
    </div>
  );
}
