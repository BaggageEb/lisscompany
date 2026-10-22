import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { Spinner } from './Spinner';
import './button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'gold' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  children: ReactNode;
}

function classes(variant: ButtonVariant, size: ButtonSize, fullWidth: boolean, extra?: string): string {
  return ['lc-btn', `lc-btn--${variant}`, `lc-btn--${size}`, fullWidth ? 'lc-btn--block' : '', extra ?? '']
    .filter(Boolean)
    .join(' ');
}

export interface ButtonProps
  extends CommonProps,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Mostra um spinner e desactiva o botão; usa aria-busy para leitores de ecrã. */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', fullWidth = false, loading = false, disabled, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={rest.type ?? 'button'}
      className={classes(variant, size, fullWidth, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Spinner size="sm" className="lc-btn__spinner" />}
      <span className={loading ? 'lc-btn__label--busy' : undefined}>{children}</span>
    </button>
  );
});

export interface ButtonLinkProps
  extends CommonProps,
    Omit<LinkProps, 'className' | 'children'> {
  className?: string;
}

/** Link estilizado como botão — mantém a semântica de navegação para teclado e leitores. */
export function ButtonLink({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link className={classes(variant, size, fullWidth, className)} {...rest}>
      {children}
    </Link>
  );
}
