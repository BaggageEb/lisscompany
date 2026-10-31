import { useCallback, useEffect, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Spinner } from '../../components/ui/Spinner';
import { Drawer, Notice, PageHead, TextArea, describeError } from '../../components/admin/AdminUi';
import {
  ApiError,
  deleteAdminZone,
  fetchAdminSettings,
  fetchAdminZones,
  saveAdminSettings,
  saveAdminZone,
  type AdminSettings,
  type DeliveryZone,
} from '../../lib/api';
import { formatKz } from '../../lib/money';

type TabId = 'contactos' | 'pagamentos' | 'levantamento' | 'entrega' | 'politicas';

const TABS: { id: TabId; label: string }[] = [
  { id: 'contactos', label: 'Contactos' },
  { id: 'pagamentos', label: 'Pagamentos' },
  { id: 'levantamento', label: 'Levantamento' },
  { id: 'entrega', label: 'Entrega' },
  { id: 'politicas', label: 'Políticas e termos' },
];

const bool = (value: string | undefined, fallback: boolean) => (value ? value === 'true' : fallback);

/**
 * Definições da loja: tudo o que antes estaria em código (contactos, IBAN,
 * Multicaixa Express, levantamento, tarifas de entrega e textos legais) é
 * configurado aqui. Os dados bancários nunca são públicos nem vão para a
 * auditoria.
 */
export function AdminSettingsPage() {
  const [tab, setTab] = useState<TabId>('contactos');
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchAdminSettings(controller.signal)
      .then(setSettings)
      .catch((cause) => {
        if (!controller.signal.aborted) setError(describeError(cause));
      });
    return () => controller.abort();
  }, []);

  return (
    <>
      <PageHead title="Definições da loja" lead="Contactos, formas de pagamento, levantamento, entrega e textos legais." />
      <div className="lc-tabs" role="tablist" aria-label="Definições">
        {TABS.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {!settings && !error ? (
        <div role="status" className="lc-empty">
          <Spinner size="lg" />
        </div>
      ) : settings ? (
        <>
          {tab === 'contactos' && (
            <SettingsForm
              key="contactos"
              title="Contactos públicos"
              settings={settings}
              onSaved={setSettings}
              fields={[
                { key: 'contact.phone', label: 'Telefone' },
                { key: 'contact.whatsapp', label: 'WhatsApp' },
                { key: 'contact.email', label: 'E-mail' },
                { key: 'contact.address', label: 'Morada da loja' },
                { key: 'contact.hours', label: 'Horário de atendimento' },
                { key: 'contact.instagram', label: 'Instagram' },
                { key: 'contact.facebook', label: 'Facebook' },
              ]}
            />
          )}
          {tab === 'pagamentos' && (
            <SettingsForm
              key="pagamentos"
              title="Formas de pagamento"
              intro="Estes dados só são mostrados ao cliente depois de fazer a encomenda. Nunca aparecem na loja pública nem na auditoria."
              settings={settings}
              onSaved={setSettings}
              fields={[
                { key: 'payment.iban_enabled', label: 'Aceitar transferência bancária (IBAN)', type: 'bool', fallback: true },
                { key: 'payment.holder', label: 'Titular da conta' },
                { key: 'payment.iban', label: 'IBAN / NIB' },
                { key: 'payment.multicaixa_enabled', label: 'Aceitar Multicaixa Express', type: 'bool', fallback: true },
                { key: 'payment.multicaixa_number', label: 'Número Multicaixa Express' },
                { key: 'payment.on_delivery_enabled', label: 'Aceitar pagamento na entrega/levantamento', type: 'bool', fallback: true },
                { key: 'payment.on_delivery_note', label: 'Instruções do pagamento na entrega', type: 'text' },
              ]}
            />
          )}
          {tab === 'levantamento' && (
            <SettingsForm
              key="levantamento"
              title="Levantamento na loja"
              settings={settings}
              onSaved={setSettings}
              fields={[
                { key: 'pickup.enabled', label: 'Permitir levantamento', type: 'bool', fallback: true },
                { key: 'pickup.address', label: 'Morada de levantamento' },
                { key: 'pickup.hours', label: 'Horário de levantamento' },
                { key: 'pickup.instructions', label: 'Instruções ao cliente', type: 'text' },
                { key: 'pickup.ask_slot', label: 'Pedir ao cliente a data/hora pretendida', type: 'bool', fallback: false },
              ]}
            />
          )}
          {tab === 'entrega' && (
            <>
              <SettingsForm
                key="entrega"
                title="Entrega ao domicílio"
                settings={settings}
                onSaved={setSettings}
                fields={[
                  { key: 'delivery.enabled', label: 'Permitir entrega', type: 'bool', fallback: true },
                  { key: 'delivery.notes', label: 'Notas sobre entregas', type: 'text' },
                ]}
              />
              <ZonesPanel />
            </>
          )}
          {tab === 'politicas' && (
            <SettingsForm
              key="politicas"
              title="Políticas e termos"
              intro="Se publicar os «Termos e condições», o cliente tem de os aceitar para encomendar."
              settings={settings}
              onSaved={setSettings}
              fields={[
                { key: 'policy.terms', label: 'Termos e condições', type: 'long' },
                { key: 'policy.privacy', label: 'Política de privacidade', type: 'long' },
                { key: 'policy.cancellation', label: 'Política de cancelamento', type: 'long' },
                { key: 'policy.refunds', label: 'Política de reembolsos', type: 'long' },
                { key: 'policy.delivery', label: 'Política de entregas', type: 'long' },
              ]}
            />
          )}
        </>
      ) : null}
    </>
  );
}

interface FieldDef {
  key: string;
  label: string;
  type?: 'string' | 'text' | 'long' | 'bool';
  fallback?: boolean;
}

function SettingsForm({
  title,
  intro,
  fields,
  settings,
  onSaved,
}: {
  title: string;
  intro?: string;
  fields: FieldDef[];
  settings: AdminSettings;
  onSaved: (next: AdminSettings) => void;
}) {
  const [values, setValues] = useState<AdminSettings>(() =>
    Object.fromEntries(fields.map((field) => [field.key, settings[field.key] ?? ''])),
  );
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setDone(false);
    setError(null);
    setFieldErrors({});
    try {
      const next = await saveAdminSettings(values);
      onSaved(next);
      setDone(true);
    } catch (cause) {
      if (cause instanceof ApiError && Object.keys(cause.fieldErrors).length > 0) setFieldErrors(cause.fieldErrors);
      else setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="lc-panel lc-form" onSubmit={submit} noValidate>
      <h2>{title}</h2>
      {intro && <p>{intro}</p>}
      {done && <Notice tone="ok">Definições guardadas.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {fields.map((field) => {
        if (field.type === 'bool') {
          return (
            <label className="lc-check" key={field.key}>
              <input
                type="checkbox"
                checked={bool(values[field.key], field.fallback ?? false)}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: String(e.target.checked) }))}
              />
              {field.label}
            </label>
          );
        }
        if (field.type === 'text' || field.type === 'long') {
          return (
            <TextArea
              key={field.key}
              label={field.label}
              style={field.type === 'long' ? { minHeight: '11rem' } : undefined}
              value={values[field.key] ?? ''}
              error={fieldErrors[field.key]}
              onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
            />
          );
        }
        return (
          <Input
            key={field.key}
            label={field.label}
            value={values[field.key] ?? ''}
            error={fieldErrors[field.key]}
            onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
          />
        );
      })}
      <div className="lc-form__actions">
        <Button type="submit" loading={busy}>
          Guardar alterações
        </Button>
      </div>
    </form>
  );
}

function ZonesPanel() {
  const [zones, setZones] = useState<DeliveryZone[] | null>(null);
  const [editing, setEditing] = useState<DeliveryZone | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setZones(await fetchAdminZones());
    } catch (cause) {
      setError(describeError(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="lc-panel" aria-labelledby="zones-title">
      <div className="lc-pagehead">
        <div>
          <h2 id="zones-title">Zonas e tarifas de entrega</h2>
          <p>Sem zonas, a entrega fica «a combinar». Com zonas, o cliente escolhe uma e a tarifa é calculada no servidor.</p>
        </div>
        <Button onClick={() => setEditing('new')}>+ Nova zona</Button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {!zones ? (
        <Spinner />
      ) : zones.length === 0 ? (
        <p className="lc-empty">Ainda não há zonas de entrega.</p>
      ) : (
        <div className="lc-tablewrap">
          <table className="lc-table">
            <thead>
              <tr>
                <th>Zona</th>
                <th className="lc-table__num">Tarifa</th>
                <th className="lc-table__num">Grátis a partir de</th>
                <th>Prazo / horário</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {zones.map((zone) => (
                <tr key={zone.id}>
                  <td>
                    <strong>{zone.name}</strong>
                  </td>
                  <td className="lc-table__num">{formatKz(zone.fee)}</td>
                  <td className="lc-table__num">{zone.freeOver ? formatKz(zone.freeOver) : '—'}</td>
                  <td>{[zone.leadTime, zone.schedule].filter(Boolean).join(' · ') || '—'}</td>
                  <td>{zone.active ? <Badge tone="success">Activa</Badge> : <Badge tone="neutral">Inactiva</Badge>}</td>
                  <td>
                    <Button size="sm" variant="secondary" onClick={() => setEditing(zone)}>
                      Editar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <ZoneForm
          zone={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </section>
  );
}

function ZoneForm({ zone, onClose, onSaved }: { zone: DeliveryZone | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({
    name: zone?.name ?? '',
    fee: zone?.fee ?? '',
    freeOver: zone?.freeOver ?? '',
    leadTime: zone?.leadTime ?? '',
    schedule: zone?.schedule ?? '',
    active: zone?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await saveAdminZone(zone?.id ?? null, {
        name: form.name,
        fee: form.fee,
        freeOver: form.freeOver || undefined,
        leadTime: form.leadTime || undefined,
        schedule: form.schedule || undefined,
        active: form.active,
      });
      await onSaved();
    } catch (cause) {
      if (cause instanceof ApiError && Object.keys(cause.fieldErrors).length > 0) setFieldErrors(cause.fieldErrors);
      else setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!zone) return;
    try {
      await deleteAdminZone(zone.id);
      await onSaved();
    } catch (cause) {
      setError(describeError(cause));
    }
  }

  return (
    <Drawer title={zone ? `Editar zona: ${zone.name}` : 'Nova zona de entrega'} onClose={onClose}>
      <form className="lc-form" onSubmit={submit} noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        <Input label="Nome da zona" required value={form.name} error={fieldErrors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <div className="lc-form__row">
          <Input label="Tarifa (Kz)" required inputMode="decimal" value={form.fee} error={fieldErrors.fee} hint="0 = entrega gratuita." onChange={(e) => setForm({ ...form, fee: e.target.value })} />
          <Input label="Grátis a partir de (Kz)" inputMode="decimal" value={form.freeOver} error={fieldErrors.freeOver} hint="Opcional." onChange={(e) => setForm({ ...form, freeOver: e.target.value })} />
        </div>
        <Input label="Prazo de entrega" value={form.leadTime} onChange={(e) => setForm({ ...form, leadTime: e.target.value })} />
        <Input label="Horário de entregas" value={form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.value })} />
        <label className="lc-check">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          Zona activa
        </label>
        <div className="lc-form__actions">
          <Button type="submit" loading={busy}>
            Guardar
          </Button>
          {zone && (
            <Button variant="danger" onClick={() => void remove()}>
              Remover zona
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
