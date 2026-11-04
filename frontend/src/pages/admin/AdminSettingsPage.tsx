import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Spinner } from '../../components/ui/Spinner';
import { Notice, PageHead, TextArea, describeError } from '../../components/admin/AdminUi';
import { ApiError, fetchAdminSettings, saveAdminSettings, type AdminSettings } from '../../lib/api';

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
              <p className="lc-panel">
                Os preços de entrega (preço fixo, por zona ou gratuita) configuram-se em{' '}
                <Link to="/admin/entregas">Configuração de entregas</Link>.
              </p>
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
