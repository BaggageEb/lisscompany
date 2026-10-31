import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Spinner } from '../../components/ui/Spinner';
import {
  Drawer,
  GalleryField,
  ImageField,
  Notice,
  PageHead,
  Select,
  TextArea,
  describeError,
} from '../../components/admin/AdminUi';
import {
  ApiError,
  adjustStock,
  createAdminProduct,
  deleteAdminCategory,
  fetchAdminCategories,
  fetchAdminProducts,
  saveAdminCategory,
  updateAdminProduct,
  type AdminCategory,
  type AdminProduct,
  type AdminProductBody,
} from '../../lib/api';
import { formatKz } from '../../lib/money';

const STATUS_LABEL: Record<string, { label: string; tone: 'success' | 'neutral' | 'warning' }> = {
  ACTIVE: { label: 'À venda', tone: 'success' },
  HIDDEN: { label: 'Oculto', tone: 'warning' },
  ARCHIVED: { label: 'Arquivado', tone: 'neutral' },
};

const EMPTY: AdminProductBody = {
  name: '',
  description: '',
  basePrice: '',
  categoryId: '',
  status: 'ACTIVE',
  cakeStudioBase: false,
  imageUrl: null,
  gallery: [],
};

/**
 * Bolos e produtos: a proprietária cria, edita, esconde e fotografa o catálogo
 * sem tocar em código. Preços e estado são validados e auditados no servidor.
 */
export function AdminProductsPage() {
  const [products, setProducts] = useState<AdminProduct[] | null>(null);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminProduct | 'new' | null>(null);
  const [showCategories, setShowCategories] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([fetchAdminProducts(), fetchAdminCategories()]);
      setProducts(p);
      setCategories(c);
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (products ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || p.categoryName.toLowerCase().includes(q));
  }, [products, query]);

  return (
    <>
      <PageHead
        title="Bolos e produtos"
        lead="Adicione bolos com fotografias, preços e descrição. O que ficar «À venda» aparece na loja."
        actions={
          <>
            <Button variant="secondary" onClick={() => setShowCategories(true)}>
              Categorias
            </Button>
            <Button onClick={() => setEditing('new')} disabled={categories.length === 0}>
              + Novo produto
            </Button>
          </>
        }
      />
      {saved && <Notice tone="ok">{saved}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {categories.length === 0 && products && (
        <Notice tone="warn">Crie primeiro uma categoria (ex.: «Bolos de aniversário») para poder adicionar produtos.</Notice>
      )}

      <div className="lc-toolbar">
        <Input
          label="Pesquisar"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Nome ou categoria"
        />
      </div>

      {!products ? (
        <div role="status" className="lc-empty">
          <Spinner size="lg" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="lc-empty">Ainda não há produtos. Use «Novo produto» para adicionar o primeiro bolo.</p>
      ) : (
        <div className="lc-tablewrap">
          <table className="lc-table">
            <thead>
              <tr>
                <th>Foto</th>
                <th>Produto</th>
                <th>Categoria</th>
                <th className="lc-table__num">Preço</th>
                <th className="lc-table__num">Stock</th>
                <th>Estado</th>
                <th>
                  <span className="lc-visually-hidden">Acções</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((product) => {
                const status = STATUS_LABEL[product.status] ?? { label: product.status, tone: 'neutral' as const };
                return (
                  <tr key={product.id}>
                    <td>
                      {product.imageUrl ? (
                        <img className="lc-table__thumb" src={product.imageUrl} alt={`Fotografia de ${product.name}`} loading="lazy" />
                      ) : (
                        <span className="lc-table__thumb lc-table__thumb--empty" aria-label="Sem fotografia">
                          ✿
                        </span>
                      )}
                    </td>
                    <td>
                      <strong>{product.name}</strong>
                      {product.cakeStudioBase && (
                        <div>
                          <Badge tone="gold">Base do Cake Studio</Badge>
                        </div>
                      )}
                    </td>
                    <td>{product.categoryName}</td>
                    <td className="lc-table__num">{formatKz(product.basePrice)}</td>
                    <td className="lc-table__num">{product.stockQty == null ? '—' : product.stockQty}</td>
                    <td>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </td>
                    <td>
                      <Button size="sm" variant="secondary" onClick={() => setEditing(product)}>
                        Editar
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ProductForm
          product={editing === 'new' ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={async (message) => {
            setEditing(null);
            setSaved(message);
            await load();
          }}
        />
      )}
      {showCategories && (
        <CategoriesDrawer
          categories={categories}
          onClose={() => setShowCategories(false)}
          onChanged={load}
        />
      )}
    </>
  );
}

function ProductForm({
  product,
  categories,
  onClose,
  onSaved,
}: {
  product: AdminProduct | null;
  categories: AdminCategory[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [form, setForm] = useState<AdminProductBody>(
    product
      ? {
          name: product.name,
          description: product.description,
          basePrice: product.basePrice,
          categoryId: product.categoryId,
          status: product.status,
          cakeStudioBase: product.cakeStudioBase,
          imageUrl: product.imageUrl,
          gallery: product.gallery,
        }
      : { ...EMPTY, categoryId: categories[0]?.id ?? '' },
  );
  const [stock, setStock] = useState(product?.stockQty == null ? '' : String(product.stockQty));
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof AdminProductBody>(key: K, value: AdminProductBody[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const saved = product ? await updateAdminProduct(product.id, form) : await createAdminProduct(form);
      // Stock opcional: ajusta pela diferença (o servidor audita o movimento).
      const wanted = stock.trim() === '' ? null : Number.parseInt(stock, 10);
      if (wanted !== null && !Number.isNaN(wanted) && wanted !== (saved.stockQty ?? 0)) {
        await adjustStock(saved.id, { delta: wanted - (saved.stockQty ?? 0), note: 'Definido na ficha do produto' });
      }
      await onSaved(`«${saved.name}» guardado.`);
    } catch (cause) {
      if (cause instanceof ApiError && Object.keys(cause.fieldErrors).length > 0) {
        setFieldErrors(cause.fieldErrors);
      } else {
        setError(describeError(cause));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer title={product ? `Editar: ${product.name}` : 'Novo produto'} onClose={onClose}>
      <form className="lc-form" onSubmit={submit} noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        <Input label="Nome do produto" required value={form.name} error={fieldErrors.name} onChange={(e) => set('name', e.target.value)} />
        <TextArea label="Descrição" value={form.description} error={fieldErrors.description} onChange={(e) => set('description', e.target.value)} />
        <div className="lc-form__row">
          <Input
            label="Preço (Kz)"
            required
            inputMode="decimal"
            value={form.basePrice}
            error={fieldErrors.basePrice}
            onChange={(e) => set('basePrice', e.target.value)}
          />
          <Select label="Categoria" value={form.categoryId} error={fieldErrors.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="lc-form__row">
          <Select label="Estado na loja" value={form.status} onChange={(e) => set('status', e.target.value)}>
            <option value="ACTIVE">À venda</option>
            <option value="HIDDEN">Oculto (rascunho)</option>
            <option value="ARCHIVED">Arquivado</option>
          </Select>
          <Input
            label="Quantidade em stock"
            inputMode="numeric"
            value={stock}
            hint="Vazio = stock não controlado (sempre disponível)."
            onChange={(e) => setStock(e.target.value.replace(/[^0-9]/g, ''))}
          />
        </div>
        <ImageField label="Fotografia principal" value={form.imageUrl} alt={`Fotografia de ${form.name || 'produto'}`} onChange={(url) => set('imageUrl', url)} />
        <GalleryField value={form.gallery} alt={form.name || 'Produto'} onChange={(urls) => set('gallery', urls)} />
        <label className="lc-check">
          <input type="checkbox" checked={form.cakeStudioBase} onChange={(e) => set('cakeStudioBase', e.target.checked)} />
          Usar como produto-base do Cake Studio (só um produto activo pode ser a base)
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

function CategoriesDrawer({
  categories,
  onClose,
  onChanged,
}: {
  categories: AdminCategory[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await saveAdminCategory(null, { name, displayOrder: categories.length });
      setName('');
      await onChanged();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove(category: AdminCategory) {
    setError(null);
    try {
      await deleteAdminCategory(category.id);
      await onChanged();
    } catch (cause) {
      setError(describeError(cause));
    }
  }

  return (
    <Drawer title="Categorias" onClose={onClose}>
      {error && <Notice tone="error">{error}</Notice>}
      <form className="lc-form lc-form__actions" onSubmit={add} noValidate>
        <Input label="Nova categoria" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" loading={busy} disabled={name.trim().length < 2}>
          Adicionar
        </Button>
      </form>
      <div className="lc-tablewrap" style={{ marginTop: 'var(--lc-space-4)' }}>
        <table className="lc-table">
          <thead>
            <tr>
              <th>Categoria</th>
              <th className="lc-table__num">Produtos</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <tr key={category.id}>
                <td>{category.name}</td>
                <td className="lc-table__num">{category.products}</td>
                <td>
                  <Button size="sm" variant="ghost" disabled={category.products > 0} onClick={() => void remove(category)}>
                    Remover
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Drawer>
  );
}
