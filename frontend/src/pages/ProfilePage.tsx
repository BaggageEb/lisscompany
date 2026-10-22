import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ApiError,
  changePassword,
  createAddress,
  deleteAddress,
  fetchAddresses,
  fetchProfile,
  fetchSessions,
  revokeSession,
  updateAddress,
  updateProfile,
  type AddressView,
  type ProfileView,
  type SessionView,
} from '../lib/api';
import { formatInstant } from '../lib/orderStatus';
import { refreshSession, useSession } from '../lib/session';
import { Badge } from '../components/ui/Badge';
import { Button, ButtonLink } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import './account.css';
import './profile.css';

const EMPTY_ADDRESS = {
  label: '',
  recipientName: '',
  line1: '',
  line2: '',
  city: '',
  municipality: '',
  province: '',
  phone: '',
  isDefault: false,
};

/**
 * Perfil do cliente (fase 7): dados de contacto, alteração de palavra-passe e
 * moradas guardadas. O servidor valida tudo (campos próprios em 400) e é a
 * única autoridade — depois de guardar, a sessão é relida do servidor para a
 * UI reflectir exactamente o que ficou gravado.
 */
export function ProfilePage() {
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();

  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [addresses, setAddresses] = useState<AddressView[] | null>(null);
  const [sessions, setSessions] = useState<SessionView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [sessionAction, setSessionAction] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  // Formulário de dados
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  // Formulário de palavra-passe
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  // Moradas
  const [addressForm, setAddressForm] = useState<null | 'new' | string>(null);
  const [addressDraft, setAddressDraft] = useState({ ...EMPTY_ADDRESS });
  const [addressErrors, setAddressErrors] = useState<Record<string, string>>({});
  const [addressError, setAddressError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyAddress, setBusyAddress] = useState(false);

  const retry = useCallback(() => {
    setLoadError(null);
    setProfile(null);
    setAddresses(null);
    setReloadKey((key) => key + 1);
  }, []);

  useEffect(() => {
    if (session.kind !== 'authenticated') return;
    const controller = new AbortController();
    Promise.all([fetchProfile(controller.signal), fetchAddresses(controller.signal), fetchSessions(controller.signal)])
      .then(([nextProfile, nextAddresses, nextSessions]) => {
        setProfile(nextProfile);
        setAddresses(nextAddresses);
        setSessions(nextSessions);
        setDisplayName(nextProfile.displayName);
        setPhone(nextProfile.phone ?? '');
        setLoadError(null);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(
          caught instanceof ApiError
            ? caught.message
            : 'Não foi possível carregar os seus dados. Tente novamente.',
        );
      });
    return () => controller.abort();
  }, [session.kind, reloadKey]);

  function fieldError(caught: unknown, fallback: string): string {
    if (caught instanceof ApiError) {
      const first = Object.values(caught.fieldErrors)[0];
      return first ?? caught.message;
    }
    return fallback;
  }

  async function endSession(handle: string) {
    setSessionAction(handle);
    setSessionError(null);
    try {
      await revokeSession(handle);
      setSessions(await fetchSessions());
    } catch (caught) {
      setSessionError(fieldError(caught, 'Não foi possível terminar a sessão.'));
    } finally {
      setSessionAction(null);
    }
  }

  async function submitProfile(event: FormEvent) {
    event.preventDefault();
    setSavingProfile(true);
    setProfileErrors({});
    setProfileSuccess(null);
    try {
      const saved = await updateProfile({ displayName: displayName.trim(), phone: phone.trim() });
      setProfile(saved);
      setPhone(saved.phone ?? '');
      setProfileSuccess('Dados guardados.');
      // A UI passa a mostrar o que o SERVIDOR tem (fonte de verdade).
      await refreshSession();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setProfileErrors(caught.fieldErrors);
        if (Object.keys(caught.fieldErrors).length === 0) {
          setProfileSuccess(null);
          setProfileErrors({ displayName: caught.message });
        }
      } else {
        setProfileErrors({ displayName: 'Não foi possível guardar. Tente novamente.' });
      }
    } finally {
      setSavingProfile(false);
    }
  }

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    setSavingPassword(true);
    setPasswordErrors({});
    setPasswordSuccess(null);
    if (newPassword !== confirmPassword) {
      setPasswordErrors({ confirm: 'As duas palavras-passe não coincidem.' });
      setSavingPassword(false);
      return;
    }
    try {
      await changePassword({ currentPassword, newPassword });
      setPasswordSuccess('Palavra-passe alterada. Use a nova no próximo login neste dispositivo.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (caught) {
      if (caught instanceof ApiError) {
        setPasswordErrors(caught.fieldErrors);
        if (Object.keys(caught.fieldErrors).length === 0) {
          setPasswordErrors({ currentPassword: caught.message });
        }
      } else {
        setPasswordErrors({ currentPassword: 'Não foi possível alterar a palavra-passe.' });
      }
    } finally {
      setSavingPassword(false);
    }
  }

  function openNewAddress() {
    setAddressDraft({ ...EMPTY_ADDRESS });
    setAddressErrors({});
    setAddressForm('new');
  }

  function openEditAddress(address: AddressView) {
    setAddressDraft({
      label: address.label ?? '',
      recipientName: address.recipientName ?? '',
      line1: address.line1,
      line2: address.line2 ?? '',
      city: address.city,
      municipality: address.municipality ?? '',
      province: address.province ?? '',
      phone: address.phone ?? '',
      isDefault: address.isDefault,
    });
    setAddressErrors({});
    setAddressForm(address.id);
  }

  async function submitAddress(event: FormEvent) {
    event.preventDefault();
    setBusyAddress(true);
    setAddressErrors({});
    setAddressError(null);
    const body = {
      label: addressDraft.label.trim() || undefined,
      recipientName: addressDraft.recipientName.trim() || undefined,
      line1: addressDraft.line1.trim(),
      line2: addressDraft.line2.trim() || undefined,
      city: addressDraft.city.trim(),
      municipality: addressDraft.municipality.trim() || undefined,
      province: addressDraft.province.trim() || undefined,
      phone: addressDraft.phone.trim() || undefined,
      isDefault: addressDraft.isDefault,
    };
    try {
      if (addressForm === 'new') {
        await createAddress(body);
      } else if (addressForm) {
        await updateAddress(addressForm, body);
      }
      setAddresses(await fetchAddresses());
      setAddressForm(null);
    } catch (caught) {
      if (caught instanceof ApiError && Object.keys(caught.fieldErrors).length > 0) {
        setAddressErrors(caught.fieldErrors);
      } else {
        setAddressError(fieldError(caught, 'Não foi possível guardar a morada.'));
      }
    } finally {
      setBusyAddress(false);
    }
  }

  async function removeAddress(id: string) {
    setBusyAddress(true);
    setAddressError(null);
    try {
      await deleteAddress(id);
      setAddresses(await fetchAddresses());
      setConfirmDeleteId(null);
    } catch (caught) {
      setAddressError(fieldError(caught, 'Não foi possível remover a morada.'));
      setConfirmDeleteId(null);
    } finally {
      setBusyAddress(false);
    }
  }

  async function makeDefault(address: AddressView) {
    setBusyAddress(true);
    setAddressError(null);
    try {
      await updateAddress(address.id, {
        label: address.label ?? undefined,
        recipientName: address.recipientName ?? undefined,
        line1: address.line1,
        line2: address.line2 ?? undefined,
        city: address.city,
        municipality: address.municipality ?? undefined,
        province: address.province ?? undefined,
        phone: address.phone ?? undefined,
        isDefault: true,
      });
      setAddresses(await fetchAddresses());
    } catch (caught) {
      setAddressError(fieldError(caught, 'Não foi possível definir a morada predefinida.'));
    } finally {
      setBusyAddress(false);
    }
  }

  if (session.kind === 'loading') {
    return (
      <div className="lc-container lc-page lc-orders__state" role="status">
        <Spinner size="lg" />
        <p>A verificar a sessão…</p>
      </div>
    );
  }

  if (session.kind === 'anonymous') {
    return (
      <div className="lc-container lc-page lc-orders">
        <header className="lc-orders__head">
          <hr className="lc-ornament" />
          <h1 className="lc-orders__title">Perfil</h1>
          <p className="lc-orders__lead">Entre para ver e editar os seus dados.</p>
        </header>
        <div className="lc-orders__signin">
          <Button size="lg" onClick={() => navigate('/entrar', { state: { from: location.pathname } })}>
            Entrar
          </Button>
          <p>
            Ainda não tem conta?{' '}
            <Link to="/registar" state={{ from: location.pathname }}>
              Criar conta
            </Link>
          </p>
        </div>
      </div>
    );
  }

  if (loadError && profile === null) {
    return (
      <div className="lc-container lc-page lc-orders">
        <header className="lc-orders__head">
          <hr className="lc-ornament" />
          <h1 className="lc-orders__title">Perfil</h1>
        </header>
        <div className="lc-orders__banner lc-orders__banner--danger" role="alert">
          <p>{loadError}</p>
          <Button variant="secondary" size="sm" onClick={retry}>
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  if (profile === null) {
    return (
      <div className="lc-container lc-page lc-orders__state" role="status">
        <Spinner />
        <p>A carregar o seu perfil…</p>
      </div>
    );
  }

  return (
    <div className="lc-container lc-page lc-orders">
      <header className="lc-orders__head">
        <p className="lc-orders__back">
          <Link to="/conta">← Área do cliente</Link>
        </p>
        <hr className="lc-ornament" />
        <h1 className="lc-orders__title">Perfil e segurança</h1>
        <p className="lc-orders__lead">
          Os seus dados de contacto, a palavra-passe e as moradas guardadas — tudo validado no servidor.
        </p>
      </header>

      {/* ----------------------------- Dados ------------------------------ */}
      <Card as="section" elevation="raised" padding="lg" className="lc-profile__section">
        <h2>Dados de contacto</h2>
        {profileSuccess && (
          <p className="lc-profile__success" role="status">
            {profileSuccess}
          </p>
        )}
        <form className="lc-auth__form" onSubmit={submitProfile} noValidate>
          <div className="lc-auth__field">
            <label htmlFor="profile-name">Nome a mostrar</label>
            <input
              id="profile-name"
              minLength={2}
              maxLength={120}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              aria-invalid={Boolean(profileErrors.displayName)}
            />
            {profileErrors.displayName && (
              <p className="lc-auth__field-error">{profileErrors.displayName}</p>
            )}
          </div>
          <div className="lc-auth__field">
            <label htmlFor="profile-phone">Telefone (opcional)</label>
            <input
              id="profile-phone"
              type="tel"
              maxLength={30}
              autoComplete="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              aria-invalid={Boolean(profileErrors.phone)}
            />
            {profileErrors.phone && <p className="lc-auth__field-error">{profileErrors.phone}</p>}
            <p className="lc-auth__hint">
              Usado para pré-preencher o checkout e para a loja lhe falar sobre as encomendas.
            </p>
          </div>
          <div className="lc-auth__field">
            <label htmlFor="profile-email">E-mail da conta</label>
            <input id="profile-email" value={profile.email} readOnly aria-readonly="true" />
            <p className="lc-auth__hint">O e-mail de acesso não é editável nesta fase.</p>
          </div>
          <div>
            <Button type="submit" loading={savingProfile} disabled={savingProfile}>
              Guardar dados
            </Button>
          </div>
        </form>
      </Card>

      {/* -------------------------- Palavra-passe -------------------------- */}
      <Card as="section" elevation="flat" padding="lg" className="lc-profile__section">
        <h2>Palavra-passe</h2>
        <p className="lc-profile__note">
          A alteração pede a palavra-passe actual. Depois de guardar, use a nova no próximo login.
        </p>
        {passwordSuccess && (
          <p className="lc-profile__success" role="status">
            {passwordSuccess}
          </p>
        )}
        <form className="lc-auth__form" onSubmit={submitPassword} noValidate>
          <div className="lc-auth__field">
            <label htmlFor="password-current">Palavra-passe actual</label>
            <input
              id="password-current"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              aria-invalid={Boolean(passwordErrors.currentPassword)}
            />
            {passwordErrors.currentPassword && (
              <p className="lc-auth__field-error">{passwordErrors.currentPassword}</p>
            )}
          </div>
          <div className="lc-auth__field">
            <label htmlFor="password-new">Nova palavra-passe</label>
            <input
              id="password-new"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={72}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              aria-invalid={Boolean(passwordErrors.newPassword)}
            />
            {passwordErrors.newPassword && (
              <p className="lc-auth__field-error">{passwordErrors.newPassword}</p>
            )}
            <p className="lc-auth__hint">Entre 8 e 72 caracteres.</p>
          </div>
          <div className="lc-auth__field">
            <label htmlFor="password-confirm">Repetir nova palavra-passe</label>
            <input
              id="password-confirm"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              aria-invalid={Boolean(passwordErrors.confirm)}
            />
            {passwordErrors.confirm && (
              <p className="lc-auth__field-error">{passwordErrors.confirm}</p>
            )}
          </div>
          <div>
            <Button type="submit" loading={savingPassword} disabled={savingPassword}>
              Alterar palavra-passe
            </Button>
          </div>
        </form>
      </Card>

      {/* ---------------------------- Moradas ------------------------------ */}
      <Card as="section" elevation="flat" padding="lg" className="lc-profile__section">
        <h2>Moradas guardadas</h2>
        <p className="lc-profile__note">
          Servem para entregar mais rápido — a encomenda pede sempre a morada no momento, por isso nada é
          aplicado sem você escolher.
        </p>

        {addressError && (
          <div className="lc-orders__banner lc-orders__banner--danger" role="alert">
            <p>{addressError}</p>
          </div>
        )}

        {addresses === null && (
          <div className="lc-orders__state" role="status">
            <Spinner />
            <p>A carregar moradas…</p>
          </div>
        )}

        {addresses !== null && addresses.length === 0 && addressForm === null && (
          <p className="lc-profile__note">Ainda não tem moradas guardadas.</p>
        )}

        {addresses !== null && addresses.length > 0 && (
          <ul className="lc-profile__addresses">
            {addresses.map((address) => (
              <li key={address.id} className="lc-profile__address">
                <div className="lc-profile__address-main">
                  <strong>
                    {address.label || address.city}{' '}
                    {address.isDefault && <Badge tone="gold">Predefinida</Badge>}
                  </strong>
                  <span>
                    {address.line1}
                    {address.line2 ? `, ${address.line2}` : ''} · {address.city}
                    {address.municipality ? `, ${address.municipality}` : ''}
                  </span>
                  {address.recipientName && <span>Destinatário: {address.recipientName}</span>}
                </div>
                <div className="lc-profile__address-actions">
                  <Button variant="secondary" size="sm" onClick={() => openEditAddress(address)}>
                    Editar
                  </Button>
                  {!address.isDefault && (
                    <Button variant="ghost" size="sm" onClick={() => makeDefault(address)} disabled={busyAddress}>
                      Tornar predefinida
                    </Button>
                  )}
                  {confirmDeleteId === address.id ? (
                    <span className="lc-profile__confirm">
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => removeAddress(address.id)}
                        loading={busyAddress}
                      >
                        Remover
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmDeleteId(null)}
                        disabled={busyAddress}
                      >
                        Manter
                      </Button>
                    </span>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteId(address.id)}>
                      Remover
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {addressForm === null ? (
          <div style={{ marginTop: 'var(--lc-space-4)' }}>
            <Button variant="secondary" onClick={openNewAddress}>
              Adicionar morada
            </Button>
          </div>
        ) : (
          <form className="lc-auth__form lc-profile__address-form" onSubmit={submitAddress} noValidate>
            <h3>{addressForm === 'new' ? 'Nova morada' : 'Editar morada'}</h3>
            <div className="lc-profile__address-grid">
              <div className="lc-auth__field">
                <label htmlFor="address-label">Etiqueta (opcional)</label>
                <input
                  id="address-label"
                  maxLength={50}
                  value={addressDraft.label}
                  onChange={(event) => setAddressDraft({ ...addressDraft, label: event.target.value })}
                  placeholder="Ex.: Casa"
                />
              </div>
              <div className="lc-auth__field">
                <label htmlFor="address-recipient">Nome de quem recebe (opcional)</label>
                <input
                  id="address-recipient"
                  maxLength={120}
                  value={addressDraft.recipientName}
                  onChange={(event) => setAddressDraft({ ...addressDraft, recipientName: event.target.value })}
                />
              </div>
            </div>
            <div className="lc-auth__field">
              <label htmlFor="address-line1">Morada (linha 1)</label>
              <input
                id="address-line1"
                maxLength={255}
                value={addressDraft.line1}
                onChange={(event) => setAddressDraft({ ...addressDraft, line1: event.target.value })}
                aria-invalid={Boolean(addressErrors.line1)}
              />
              {addressErrors.line1 && <p className="lc-auth__field-error">{addressErrors.line1}</p>}
            </div>
            <div className="lc-auth__field">
              <label htmlFor="address-line2">Complemento (opcional)</label>
              <input
                id="address-line2"
                maxLength={255}
                value={addressDraft.line2}
                onChange={(event) => setAddressDraft({ ...addressDraft, line2: event.target.value })}
              />
            </div>
            <div className="lc-profile__address-grid">
              <div className="lc-auth__field">
                <label htmlFor="address-city">Cidade</label>
                <input
                  id="address-city"
                  maxLength={120}
                  value={addressDraft.city}
                  onChange={(event) => setAddressDraft({ ...addressDraft, city: event.target.value })}
                  aria-invalid={Boolean(addressErrors.city)}
                />
                {addressErrors.city && <p className="lc-auth__field-error">{addressErrors.city}</p>}
              </div>
              <div className="lc-auth__field">
                <label htmlFor="address-municipality">Município (opcional)</label>
                <input
                  id="address-municipality"
                  maxLength={120}
                  value={addressDraft.municipality}
                  onChange={(event) => setAddressDraft({ ...addressDraft, municipality: event.target.value })}
                />
              </div>
            </div>
            <label className="lc-profile__checkbox">
              <input
                type="checkbox"
                checked={addressDraft.isDefault}
                onChange={(event) => setAddressDraft({ ...addressDraft, isDefault: event.target.checked })}
              />
              Usar como morada predefinida
            </label>
            <div className="lc-profile__address-actions">
              <Button type="submit" loading={busyAddress} disabled={busyAddress}>
                Guardar morada
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setAddressForm(null)}
                disabled={busyAddress}
              >
                Cancelar
              </Button>
            </div>
          </form>
        )}
      </Card>

      {/* --------------------------- Sessões ----------------------------- */}
      <Card as="section" elevation="flat" padding="lg" className="lc-profile__section">
        <h2>Sessões activas</h2>
        <p className="lc-profile__note">
          Dispositivos com sessão iniciada nesta conta. Terminar uma sessão obriga esse dispositivo a
          voltar a entrar. Alterar a palavra-passe termina automaticamente as outras sessões.
        </p>

        {sessionError && (
          <div className="lc-orders__banner lc-orders__banner--danger" role="alert">
            <p>{sessionError}</p>
          </div>
        )}

        {sessions === null && (
          <div className="lc-orders__state" role="status">
            <Spinner />
            <p>A carregar sessões…</p>
          </div>
        )}

        {sessions !== null && (
          <ul className="lc-profile__addresses">
            {sessions.map((entry) => (
              <li key={entry.handle} className="lc-profile__address">
                <div className="lc-profile__address-main">
                  <strong>
                    Iniciada a {formatInstant(entry.createdAt)}{' '}
                    {entry.current && <Badge tone="success">Esta sessão</Badge>}
                  </strong>
                  {!entry.current && <span>Outro dispositivo</span>}
                </div>
                {!entry.current && (
                  <div className="lc-profile__address-actions">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => endSession(entry.handle)}
                      loading={sessionAction === entry.handle}
                      disabled={sessionAction !== null}
                    >
                      Terminar sessão
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div style={{ marginBottom: 'var(--lc-space-12)' }}>
        <ButtonLink to="/conta" variant="secondary">
          ← Área do cliente
        </ButtonLink>
      </div>
    </div>
  );
}
