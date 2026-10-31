import { useCallback, useEffect, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Spinner } from '../../components/ui/Spinner';
import { Drawer, ImageField, Notice, PageHead, Select, TextArea, describeError } from '../../components/admin/AdminUi';
import {
  ApiError,
  fetchAdminIngredients,
  saveAdminIngredient,
  type AdminIngredient,
  type AdminIngredientBody,
} from '../../lib/api';
import { formatKz } from '../../lib/money';

const KINDS: Record<string, string> = { DOUGH: 'Massa', FILLING: 'Recheio', EXTRA: 'Extra' };

const EMPTY: AdminIngredientBody = {
  kind: 'FILLING',
  name: '',
  description: '',
  priceDelta: '0',
  displayOrder: 0,
  active: true,
  imageUrl: null,
  trackStock: false,
  stockQty: null,
};

/** Massas, recheios e extras do Cake Studio: preço, fotografia, disponibilidade e stock. */
export function AdminIngredientsPage() {
  const [items, setItems] = useState<AdminIngredient[] | null>(null);
  const [kind, setKind] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminIngredient | 'new' | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await fetchAdminIngredients());
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = (items ?? []).filter((item) => !kind || item.kind === kind);

  return (
    <>
      <PageHead
        title="Cake Studio: massas, recheios e extras"
        lead="O que estiver activo e com stock aparece no construtor de bolos. «Esgotado» bloqueia a escolha no servidor."
        actions={<Button onClick={() => setEditing('new')}>+ Novo ingrediente</Button>}
      />
      {saved && <Notice tone="ok">{saved}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="lc-toolbar">
        <Select label="Tipo" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Todos</option>
          <option value="DOUGH">Massas</option>
          <option value="FILLING">Recheios</option>
          <option value="EXTRA">Extras</option>
        </Select>
      </div>

      {!items ? (
        <div role="status" className="lc-empty">
          <Spinner size="lg" />
        </div>
      ) : visible.length === 0 ? (
        <p className="lc-empty">Sem ingredientes. Adicione as massas, recheios e extras que oferece.</p>
      ) : (
        <div className="lc-tablewrap">
          <table className="lc-table">
            <thead>
              <tr>
                <th>Foto</th>
                <th>Nome</th>
                <th>Tipo</th>
                <th className="lc-table__num">Preço extra</th>
                <th className="lc-table__num">Stock</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.imageUrl ? (
                      <img className="lc-table__thumb" src={item.imageUrl} alt={`Fotografia de ${item.name}`} loading="lazy" />
                    ) : (
                      <span className="lc-table__thumb lc-table__thumb--empty" aria-label="Sem fotografia">
                        ✿
                      </span>
                    )}
                  </td>
                  <td>
                    <strong>{item.name}</strong>
                  </td>
                  <td>{KINDS[item.kind] ?? item.kind}</td>
                  <td className="lc-table__num">{formatKz(item.priceDelta)}</td>
                  <td className="lc-table__num">{item.stockQty == null ? '—' : item.stockQty}</td>
                  <td>
                    {!item.active ? <Badge tone="neutral">Oculto</Badge> : item.available ? <Badge tone="success">Disponível</Badge> : <Badge tone="danger">Esgotado</Badge>}
                  </td>
                  <td>
                    <Button size="sm" variant="secondary" onClick={() => setEditing(item)}>
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
        <IngredientForm
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (message) => {
            setEditing(null);
            setSaved(message);
            await load();
          }}
        />
      )}
    </>
  );
}

function IngredientForm({
  item,
  onClose,
  onSaved,
}: {
  item: AdminIngredient | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [form, setForm] = useState<AdminIngredientBody>(
    item
      ? {
          kind: item.kind,
          name: item.name,
          description: item.description,
          priceDelta: item.priceDelta,
          displayOrder: item.displayOrder,
          active: item.active,
          imageUrl: item.imageUrl,
          trackStock: item.stockQty != null,
          stockQty: item.stockQty,
        }
      : EMPTY,
  );
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof AdminIngredientBody>(key: K, value: AdminIngredientBody[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const saved = await saveAdminIngredient(item?.id ?? null, form);
      await onSaved(`«${saved.name}» guardado.`);
    } catch (cause) {
      if (cause instanceof ApiError && Object.keys(cause.fieldErrors).length > 0) setFieldErrors(cause.fieldErrors);
      else setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer title={item ? `Editar: ${item.name}` : 'Novo ingrediente'} onClose={onClose}>
      <form className="lc-form" onSubmit={submit} noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="lc-form__row">
          <Select label="Tipo" value={form.kind} error={fieldErrors.kind} onChange={(e) => set('kind', e.target.value)}>
            <option value="DOUGH">Massa</option>
            <option value="FILLING">Recheio</option>
            <option value="EXTRA">Extra</option>
          </Select>
          <Input label="Nome" required value={form.name} error={fieldErrors.name} onChange={(e) => set('name', e.target.value)} />
        </div>
        <TextArea label="Descrição" value={form.description} error={fieldErrors.description} onChange={(e) => set('description', e.target.value)} />
        <div className="lc-form__row">
          <Input
            label="Preço adicional (Kz)"
            inputMode="decimal"
            value={form.priceDelta}
            error={fieldErrors.priceDelta}
            hint="0 = sem custo adicional."
            onChange={(e) => set('priceDelta', e.target.value)}
          />
          <Input
            label="Ordem de apresentação"
            inputMode="numeric"
            value={String(form.displayOrder)}
            onChange={(e) => set('displayOrder', Number.parseInt(e.target.value.replace(/[^0-9]/g, '') || '0', 10))}
          />
        </div>
        <ImageField label="Fotografia" value={form.imageUrl} alt={`Fotografia de ${form.name || 'ingrediente'}`} onChange={(url) => set('imageUrl', url)} />
        <label className="lc-check">
          <input
            type="checkbox"
            checked={form.trackStock}
            onChange={(e) => {
              set('trackStock', e.target.checked);
              if (e.target.checked && form.stockQty == null) set('stockQty', 0);
            }}
          />
          Controlar stock deste ingrediente
        </label>
        {form.trackStock && (
          <Input
            label="Quantidade em stock"
            inputMode="numeric"
            value={form.stockQty == null ? '' : String(form.stockQty)}
            error={fieldErrors.stockQty}
            hint="0 = esgotado: o Cake Studio deixa de o oferecer."
            onChange={(e) => set('stockQty', e.target.value === '' ? null : Number.parseInt(e.target.value.replace(/[^0-9]/g, ''), 10))}
          />
        )}
        <label className="lc-check">
          <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
          Visível no Cake Studio
        </label>
        <div className="lc-form__actions">
          <Button type="submit" loading={busy}>
            Guardar
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
