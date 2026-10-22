import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import './input.css';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Mensagem de erro; liga-se ao input via aria-describedby e aria-invalid. */
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, id, required, className, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={['lc-field', className].filter(Boolean).join(' ')}>
      <label className="lc-field__label" htmlFor={inputId}>
        {label}
        {required && (
          <span className="lc-field__required" aria-hidden="true">
            *
          </span>
        )}
        {required && <span className="lc-visually-hidden"> (obrigatório)</span>}
      </label>
      <input
        ref={ref}
        id={inputId}
        className={['lc-input', error ? 'lc-input--invalid' : ''].filter(Boolean).join(' ')}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        required={required}
        {...rest}
      />
      {hint && (
        <p className="lc-field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="lc-field__error" id={errorId} role="alert">
          <span aria-hidden="true">✕ </span>
          {error}
        </p>
      )}
    </div>
  );
});
