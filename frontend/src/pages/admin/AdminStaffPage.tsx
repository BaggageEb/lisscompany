import { useCallback, useEffect, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Spinner } from '../../components/ui/Spinner';
import { Drawer, Notice, PageHead, describeError } from '../../components/admin/AdminUi';
import {
  ApiError,
  createAdminStaff,
  fetchAdminPermissions,
  fetchAdminRoles,
  fetchAdminStaff,
  resetAdminStaffPassword,
  saveAdminRole,
  updateAdminStaff,
  type AdminPermission,
  type AdminRole,
  type AdminStaff,
} from '../../lib/api';
import { formatInstant } from '../../lib/orderStatus';
import { PERMISSION_LABELS } from '../../lib/permissions';

/**
 * Equipa e acessos: contas secundárias, papéis e permissões. O servidor
 * impede a escalada de privilégios (ninguém concede mais do que tem, a
 * proprietária principal e a própria conta não se alteram aqui).
 */
export function AdminStaffPage() {
  const [staff, setStaff] = useState<AdminStaff[] | null>(null);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [permissions, setPermissions] = useState<AdminPermission[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);
  const [editing, setEditing] = useState<AdminStaff | 'new' | null>(null);
  const [roleEditor, setRoleEditor] = useState<AdminRole | 'new' | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, r, p] = await Promise.all([fetchAdminStaff(), fetchAdminRoles(), fetchAdminPermissions()]);
      setStaff(s);
      setRoles(r);
      setPermissions(p);
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function resetPassword(person: AdminStaff) {
    try {
      const result = await resetAdminStaffPassword(person.id);
      setSecret({ email: result.user.email, password: result.temporaryPassword });
    } catch (cause) {
      setError(describeError(cause));
    }
  }

  return (
    <>
      <PageHead
        title="Equipa e acessos"
        lead="Crie contas para colaboradores e escolha exactamente o que cada um pode fazer."
        actions={<Button onClick={() => setEditing('new')}>+ Nova conta</Button>}
      />
      {error && <Notice tone="error">{error}</Notice>}
      {secret && (
        <Notice tone="warn">
          Palavra-passe temporária de <strong>{secret.email}</strong>: <code>{secret.password}</code> — mostrada só
          agora. Entregue-a à pessoa em privado; deve alterá-la no primeiro acesso.{' '}
          <button type="button" onClick={() => setSecret(null)}>
            Já copiei
          </button>
        </Notice>
      )}

      {!staff ? (
        <div role="status" className="lc-empty">
          <Spinner size="lg" />
        </div>
      ) : (
        <div className="lc-tablewrap">
          <table className="lc-table">
            <thead>
              <tr>
                <th>Pessoa</th>
                <th>Papéis</th>
                <th>Estado</th>
                <th>Último acesso</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {staff.map((person) => (
                <tr key={person.id}>
                  <td>
                    <strong>{person.displayName}</strong>
                    <div className="lc-stat__hint">{person.email}</div>
                  </td>
                  <td>{person.owner ? <Badge tone="gold">Proprietária</Badge> : person.roles.join(', ') || '—'}</td>
                  <td>{person.status === 'ACTIVE' ? <Badge tone="success">Activa</Badge> : <Badge tone="danger">Desactivada</Badge>}</td>
                  <td>{person.lastLoginAt ? formatInstant(person.lastLoginAt) : 'Nunca'}</td>
                  <td>
                    {!person.owner && (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => setEditing(person)}>
                          Editar
                        </Button>{' '}
                        <Button size="sm" variant="ghost" onClick={() => void resetPassword(person)}>
                          Nova palavra-passe
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="lc-panel" aria-labelledby="roles-title" style={{ marginTop: 'var(--lc-space-6)' }}>
        <div className="lc-pagehead">
          <div>
            <h2 id="roles-title">Papéis e permissões</h2>
            <p>Os papéis de sistema não se alteram; crie papéis próprios para combinar permissões.</p>
          </div>
          <Button variant="secondary" onClick={() => setRoleEditor('new')}>
            + Novo papel
          </Button>
        </div>
        <div className="lc-tablewrap">
          <table className="lc-table">
            <thead>
              <tr>
                <th>Papel</th>
                <th>Permissões</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role.id}>
                  <td>
                    <strong>{role.name}</strong> {role.system && <Badge tone="blue">Sistema</Badge>}
                  </td>
                  <td>{role.permissions.map((code) => PERMISSION_LABELS[code] ?? code).join(' · ')}</td>
                  <td>
                    {!role.system && (
                      <Button size="sm" variant="secondary" onClick={() => setRoleEditor(role)}>
                        Editar
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editing && (
        <StaffForm
          person={editing === 'new' ? null : editing}
          roles={roles}
          onClose={() => setEditing(null)}
          onDone={async (created) => {
            setEditing(null);
            if (created) setSecret({ email: created.user.email, password: created.temporaryPassword });
            await load();
          }}
        />
      )}
      {roleEditor && (
        <RoleForm
          role={roleEditor === 'new' ? null : roleEditor}
          permissions={permissions}
          onClose={() => setRoleEditor(null)}
          onDone={async () => {
            setRoleEditor(null);
            await load();
          }}
        />
      )}
    </>
  );
}

function StaffForm({
  person,
  roles,
  onClose,
  onDone,
}: {
  person: AdminStaff | null;
  roles: AdminRole[];
  onClose: () => void;
  onDone: (created?: { user: AdminStaff; temporaryPassword: string }) => Promise<void>;
}) {
  const [email, setEmail] = useState(person?.email ?? '');
  const [name, setName] = useState(person?.displayName ?? '');
  const [active, setActive] = useState(person ? person.status === 'ACTIVE' : true);
  const [roleIds, setRoleIds] = useState<string[]>(
    person ? roles.filter((r) => person.roles.includes(r.name)).map((r) => r.id) : [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const toggle = (id: string) => setRoleIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      if (person) {
        await updateAdminStaff(person.id, { displayName: name, status: active ? 'ACTIVE' : 'DISABLED', roleIds });
        await onDone();
      } else {
        await onDone(await createAdminStaff({ email, displayName: name, roleIds }));
      }
    } catch (cause) {
      if (cause instanceof ApiError && Object.keys(cause.fieldErrors).length > 0) setFieldErrors(cause.fieldErrors);
      else setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer title={person ? `Editar: ${person.displayName}` : 'Nova conta de colaborador'} onClose={onClose}>
      <form className="lc-form" onSubmit={submit} noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        <Input label="Nome" required value={name} error={fieldErrors.displayName} onChange={(e) => setName(e.target.value)} />
        <Input label="E-mail" type="email" required disabled={Boolean(person)} value={email} error={fieldErrors.email} onChange={(e) => setEmail(e.target.value)} />
        <fieldset>
          <legend className="lc-field__label">Papéis</legend>
          {fieldErrors.roleIds && <p className="lc-field__error">✕ {fieldErrors.roleIds}</p>}
          <div className="lc-perms">
            {roles.map((role) => (
              <label className="lc-check" key={role.id}>
                <input type="checkbox" checked={roleIds.includes(role.id)} onChange={() => toggle(role.id)} />
                {role.name}
              </label>
            ))}
          </div>
        </fieldset>
        {person && (
          <label className="lc-check">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Conta activa (desactivar termina o acesso de imediato)
          </label>
        )}
        <div className="lc-form__actions">
          <Button type="submit" loading={busy}>
            {person ? 'Guardar' : 'Criar conta'}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

function RoleForm({
  role,
  permissions,
  onClose,
  onDone,
}: {
  role: AdminRole | null;
  permissions: AdminPermission[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [name, setName] = useState(role?.name ?? '');
  const [selected, setSelected] = useState<string[]>(role?.permissions ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (code: string) => setSelected((current) => (current.includes(code) ? current.filter((x) => x !== code) : [...current, code]));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await saveAdminRole(role?.id ?? null, { name, permissions: selected });
      await onDone();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer title={role ? `Editar papel: ${role.name}` : 'Novo papel'} onClose={onClose}>
      <form className="lc-form" onSubmit={submit} noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        <Input label="Nome do papel" required value={name} onChange={(e) => setName(e.target.value)} />
        <fieldset>
          <legend className="lc-field__label">Permissões</legend>
          <div className="lc-perms">
            {permissions.map((permission) => (
              <label className="lc-check" key={permission.code} title={permission.description}>
                <input type="checkbox" checked={selected.includes(permission.code)} onChange={() => toggle(permission.code)} />
                {PERMISSION_LABELS[permission.code] ?? permission.code}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="lc-form__actions">
          <Button type="submit" loading={busy} disabled={selected.length === 0}>
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
