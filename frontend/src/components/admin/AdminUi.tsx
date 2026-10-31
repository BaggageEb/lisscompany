import { useId, useRef, useState, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, uploadAdminImage } from '../../lib/api';
import { Button } from '../ui/Button';
import './admin-ui.css';

export function PageHead({ title, lead, actions }: { title: string; lead?: string; actions?: ReactNode }) {
  return (
    <header className="lc-pagehead">
      <div>
        <h1>{title}</h1>
        {lead && <p>{lead}</p>}
      </div>
      {actions && <div className="lc-pagehead__actions">{actions}</div>}
    </header>
  );
}

export function StatCard({
  label,
  value,
  hint,
  to,
  alert,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  to?: string;
  alert?: boolean;
}) {
  const className = `lc-stat${alert ? ' lc-stat--alert' : ''}`;
  const body = (
    <>
      <div className="lc-stat__label">{label}</div>
      <div className="lc-stat__value">{value}</div>
      {hint && <div className="lc-stat__hint">{hint}</div>}
    </>
  );
  return to ? (
    <Link to={to} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export function Notice({ tone, children }: { tone: 'ok' | 'error' | 'warn'; children: ReactNode }) {
  return (
    <p className={`lc-notice lc-notice--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}

interface FieldShellProps {
  label: string;
  error?: string;
  hint?: string;
}

export function TextArea({
  label,
  error,
  hint,
  ...rest
}: FieldShellProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <div className="lc-field">
      <label className="lc-field__label" htmlFor={id}>
        {label}
      </label>
      <textarea id={id} className="lc-textarea" aria-invalid={error ? true : undefined} {...rest} />
      {hint && <p className="lc-field__hint">{hint}</p>}
      {error && (
        <p className="lc-field__error" role="alert">
          ✕ {error}
        </p>
      )}
    </div>
  );
}

export function Select({
  label,
  error,
  hint,
  children,
  ...rest
}: FieldShellProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div className="lc-field">
      <label className="lc-field__label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="lc-select" aria-invalid={error ? true : undefined} {...rest}>
        {children}
      </select>
      {hint && <p className="lc-field__hint">{hint}</p>}
      {error && (
        <p className="lc-field__error" role="alert">
          ✕ {error}
        </p>
      )}
    </div>
  );
}

/** Mensagem legível para qualquer erro de API (mostra os erros de campo quando existem). */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    const fields = Object.values(error.fieldErrors);
    return fields.length > 0 ? fields.join(' ') : error.message;
  }
  return 'Ocorreu um erro inesperado. Tente novamente.';
}

export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="lc-drawer" role="dialog" aria-modal="true" aria-label={title}>
      <div className="lc-drawer__panel">
        <div className="lc-drawer__head">
          <h2>{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Fechar">
            ✕ Fechar
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Campo de fotografia: escolhe o ficheiro, envia para o servidor (que valida
 * os bytes — só PNG/JPEG/WebP até 5 MB) e guarda o URL devolvido.
 */
export function ImageField({
  label,
  value,
  onChange,
  alt,
}: {
  label: string;
  value: string | null;
  onChange: (url: string | null) => void;
  alt: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { url } = await uploadAdminImage(file);
      onChange(url);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="lc-field">
      <span className="lc-field__label">{label}</span>
      <div className="lc-imagefield">
        {value ? (
          <img className="lc-imagefield__preview" src={value} alt={alt} />
        ) : (
          <div className="lc-imagefield__preview" aria-hidden="true">
            Sem fotografia
          </div>
        )}
        <div>
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            aria-label={`Escolher ficheiro: ${label}`}
            onChange={(event) => void pick(event.target.files?.[0])}
          />
          <Button variant="secondary" size="sm" loading={busy} onClick={() => input.current?.click()}>
            {value ? 'Trocar fotografia' : 'Carregar fotografia'}
          </Button>{' '}
          {value && (
            <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
              Remover
            </Button>
          )}
          <p className="lc-field__hint">PNG, JPEG ou WebP, até 5 MB.</p>
          {error && (
            <p className="lc-field__error" role="alert">
              ✕ {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Galeria de várias fotografias com remoção individual. */
export function GalleryField({
  value,
  onChange,
  alt,
}: {
  value: string[];
  onChange: (urls: string[]) => void;
  alt: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const urls: string[] = [];
      for (const file of Array.from(files)) {
        urls.push((await uploadAdminImage(file)).url);
      }
      onChange([...value, ...urls]);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="lc-field">
      <span className="lc-field__label">Galeria de fotografias</span>
      <div className="lc-gallery">
        {value.map((url, index) => (
          <div className="lc-gallery__item" key={url}>
            <img src={url} alt={`${alt} — foto ${index + 1}`} />
            <button
              type="button"
              className="lc-gallery__remove"
              aria-label={`Remover foto ${index + 1}`}
              onClick={() => onChange(value.filter((u) => u !== url))}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <input
        ref={input}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        hidden
        aria-label="Adicionar fotografias à galeria"
        onChange={(event) => void add(event.target.files)}
      />
      <p>
        <Button variant="secondary" size="sm" loading={busy} onClick={() => input.current?.click()}>
          Adicionar fotografias
        </Button>
      </p>
      {error && (
        <p className="lc-field__error" role="alert">
          ✕ {error}
        </p>
      )}
    </div>
  );
}
