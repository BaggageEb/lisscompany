import { useCallback, useEffect, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Spinner } from '../../components/ui/Spinner';
import { Drawer, Notice, PageHead, describeError } from '../../components/admin/AdminUi';
import {
  ApiError,
  deleteAdminZone,
  fetchAdminDeliveryConfig,
  fetchAdminZones,
  saveAdminDeliveryConfig,
  saveAdminZone,
  type DeliveryConfig,
  type DeliveryMode,
  type DeliveryZone,
} from '../../lib/api';
import { formatKz } from '../../lib/money';

const MODES: { id: DeliveryMode; title: string; text: string }[] = [
  { id: 'FLAT', title: 'Preço fixo', text: 'O mesmo preço para qualquer entrega ao domicílio.' },
  { id: 'ZONES', title: 'Preço por zona', text: 'Cada zona tem o seu preço; o cliente escolhe a zona no checkout.' },
  { id: 'FREE', title: 'Entrega gratuita', text: 'Nenhuma entrega é cobrada.' },
];

/**
 * Configuração de entregas: como a entrega ao domicílio é cobrada (preço fixo,
 * por zona ou gratuita) e as zonas. O cliente nunca consegue confirmar uma
 * entrega sem preço configurado — o servidor recusa.
 */
export function AdminDeliveryPage() {
  const [config, setConfig] = useState<DeliveryConfig | null>(null);
  const [zones, setZones] = useState<DeliveryZone[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, z] = await Promise.all([fetchAdminDeliveryConfig(), fetchAdminZones()]);
      setConfig(c);
      setZones(z);
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHead
        title="Configuração de entregas"
        lead="Defina quanto cobra pela entrega ao domicílio. O valor é calculado no servidor e mostrado ao cliente antes de confirmar."
      />
      {error && <Notice tone="error">{error}</Notice>}
      {!config || !zones ? (
        <Spinner />
      ) : (
        <>
          {config.ready ? (
            <Notice tone="ok">A entrega ao domicílio está pronta: os clientes já podem escolhê-la.</Notice>
          ) : (
            <Notice tone="warn">
              Os clientes ainda não conseguem confirmar entregas ao domicílio. {config.problems.join(' ')}
            </Notice>
          )}
          <ModePanel config={config} onSaved={(c) => setConfig(c)} />
          <ZonesPanel zones={zones} mode={config.mode} onChanged={load} />
        </>
      )}
    </>
  );
}

function ModePanel({ config, onSaved }: { config: DeliveryConfig; onSaved: (config: DeliveryConfig) => void }) {
  const [mode, setMode] = useState<DeliveryMode | null>(config.mode);
  const [flatFee, setFlatFee] = useState(config.flatFee ?? '');
  const [freeOver, setFreeOver] = useState(config.flatFreeOver ?? '');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!mode) {
      setError('Escolha como cobrar a entrega.');
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    setFieldErrors({});
    try {
      const result = await saveAdminDeliveryConfig({
        mode,
        ...(mode === 'FLAT' && flatFee ? { flatFee } : {}),
        ...(mode === 'FLAT' && freeOver ? { flatFreeOver: freeOver } : {}),
      });
      onSaved(result);
      setSaved(true);
    } catch (cause) {
      if (cause instanceof ApiError && Object.keys(cause.fieldErrors).length > 0) setFieldErrors(cause.fieldErrors);
      else setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="lc-panel" aria-labelledby="delivery-mode-title">
      <h2 id="delivery-mode-title">Como cobrar a entrega</h2>
      <form className="lc-form" onSubmit={submit} noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        {fieldErrors.mode && <Notice tone="error">{fieldErrors.mode}</Notice>}
        <div role="radiogroup" aria-label="Modo de entrega" style={{ display: 'grid', gap: '0.6rem' }}>
          {MODES.map((option) => (
            <label key={option.id} className="lc-check" style={{ alignItems: 'flex-start' }}>
              <input
                type="radio"
                name="delivery-mode"
                value={option.id}
                checked={mode === option.id}
                onChange={() => setMode(option.id)}
              />
              <span>
                <strong>{option.title}</strong>
                <br />
                <small>{option.text}</small>
              </span>
            </label>
          ))}
        </div>
        {mode === 'FLAT' && (
          <div className="lc-form__row">
            <Input
              label="Preço fixo da entrega (Kz)"
              required
              inputMode="decimal"
              value={flatFee}
              error={fieldErrors.flatFee}
              onChange={(e) => setFlatFee(e.target.value)}
            />
            <Input
              label="Grátis a partir de (Kz)"
              inputMode="decimal"
              value={freeOver}
              error={fieldErrors.flatFreeOver}
              hint="Opcional: entrega gratuita acima deste valor em artigos."
              onChange={(e) => setFreeOver(e.target.value)}
            />
          </div>
        )}
        <div className="lc-form__actions">
          <Button type="submit" loading={busy}>
            Guardar modo de entrega
          </Button>
          {saved && <span role="status">Guardado.</span>}
        </div>
      </form>
    </section>
  );
}

function priceLabel(zone: DeliveryZone): string {
  if (zone.freeDelivery) return 'Grátis';
  return zone.fee === null ? 'Sem preço' : formatKz(zone.fee);
}

function ZonesPanel({
  zones,
  mode,
  onChanged,
}: {
  zones: DeliveryZone[];
  mode: DeliveryMode | null;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<DeliveryZone | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(zone: DeliveryZone) {
    setError(null);
    try {
      await saveAdminZone(zone.id, {
        name: zone.name,
        fee: zone.fee ?? undefined,
        freeDelivery: zone.freeDelivery,
        freeOver: zone.freeOver ?? undefined,
        leadTime: zone.leadTime ?? undefined,
        schedule: zone.schedule ?? undefined,
        displayOrder: zone.displayOrder,
        active: !zone.active,
      });
      await onChanged();
    } catch (cause) {
      setError(describeError(cause));
    }
  }

  return (
    <section className="lc-panel" aria-labelledby="zones-title">
      <div className="lc-pagehead">
        <div>
          <h2 id="zones-title">Zonas de entrega</h2>
          <p>
            {mode === 'ZONES'
              ? 'Só as zonas activas e com preço (ou gratuitas) podem ser escolhidas pelo cliente.'
              : 'As zonas só são usadas no modo «Preço por zona».'}
          </p>
        </div>
        <Button onClick={() => setEditing('new')}>+ Nova zona</Button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {zones.length === 0 ? (
        <p className="lc-empty">Ainda não há zonas de entrega.</p>
      ) : (
        <div className="lc-tablewrap">
          <table className="lc-table">
            <thead>
              <tr>
                <th>Zona</th>
                <th className="lc-table__num">Preço</th>
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
                  <td className="lc-table__num">{priceLabel(zone)}</td>
                  <td className="lc-table__num">{zone.freeOver ? formatKz(zone.freeOver) : '—'}</td>
                  <td>{[zone.leadTime, zone.schedule].filter(Boolean).join(' · ') || '—'}</td>
                  <td>{zone.active ? <Badge tone="success">Activa</Badge> : <Badge tone="neutral">Inactiva</Badge>}</td>
                  <td>
                    <Button size="sm" variant="secondary" onClick={() => void toggle(zone)}>
                      {zone.active ? 'Desactivar' : 'Activar'}
                    </Button>{' '}
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
            await onChanged();
          }}
        />
      )}
    </section>
  );
}

function ZoneForm({
  zone,
  onClose,
  onSaved,
}: {
  zone: DeliveryZone | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: zone?.name ?? '',
    fee: zone?.freeDelivery ? '' : (zone?.fee ?? ''),
    free: zone?.freeDelivery ?? false,
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
        ...(form.free ? { freeDelivery: true } : form.fee ? { fee: form.fee } : {}),
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
        <Input
          label="Nome da zona"
          required
          value={form.name}
          error={fieldErrors.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <label className="lc-check">
          <input
            type="checkbox"
            checked={form.free}
            onChange={(e) => setForm({ ...form, free: e.target.checked })}
          />
          Entrega gratuita nesta zona
        </label>
        {!form.free && (
          <div className="lc-form__row">
            <Input
              label="Preço da entrega (Kz)"
              inputMode="decimal"
              value={form.fee}
              error={fieldErrors.fee}
              hint="Obrigatório para activar a zona (ou marque entrega gratuita)."
              onChange={(e) => setForm({ ...form, fee: e.target.value })}
            />
            <Input
              label="Grátis a partir de (Kz)"
              inputMode="decimal"
              value={form.freeOver}
              error={fieldErrors.freeOver}
              hint="Opcional."
              onChange={(e) => setForm({ ...form, freeOver: e.target.value })}
            />
          </div>
        )}
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
