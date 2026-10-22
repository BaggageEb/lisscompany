import './spinner.css';

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  /** Texto alternativo; omitir quando o spinner acompanha um elemento com aria-busy. */
  label?: string;
  className?: string;
}

export function Spinner({ size = 'md', label, className }: SpinnerProps) {
  return (
    <span
      className={['lc-spinner', `lc-spinner--${size}`, className].filter(Boolean).join(' ')}
      role={label ? 'status' : undefined}
      aria-hidden={label ? undefined : true}
    >
      {label && <span className="lc-visually-hidden">{label}</span>}
    </span>
  );
}
