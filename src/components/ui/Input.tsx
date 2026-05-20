'use client';

import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

type InputAppearance = 'default' | 'minimal';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  /** Merged onto the label element when `label` is set (minimal appearance included). */
  labelClassName?: string;
  error?: string;
  icon?: ReactNode;
  hint?: string;
  appearance?: InputAppearance;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, labelClassName, error, icon, hint, className = '', id, appearance = 'default', ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');

    const defaultInputClass =
      'block min-h-10 w-full min-w-0 rounded-xl border px-3 py-2 text-sm shadow-sm transition-[color,box-shadow,border-color] placeholder:text-[var(--text-muted)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50';

    const minimalInputClass =
      'block min-h-10 w-full min-w-0 rounded-none border-0 border-b border-[var(--border-subtle)] bg-transparent px-0 py-2.5 text-sm shadow-none transition-[color,box-shadow,border-color] placeholder:text-[var(--text-muted)] focus:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50';

    const defaultStateClass = error
      ? 'border-red-400/70 bg-[var(--surface-2)] text-[var(--foreground)] focus:border-red-400 focus:ring-2 focus:ring-red-400 focus:ring-offset-0'
      : 'border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--foreground)] focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)] focus:ring-offset-0';

    const minimalStateClass = error
      ? 'border-red-400/80 text-[var(--foreground)] focus-visible:border-red-400 focus-visible:shadow-[0_1px_0_0_rgb(248_113_113/0.85)]'
      : 'text-[var(--foreground)] focus-visible:border-[var(--brand)] focus-visible:shadow-[0_0_0_1px_rgb(123_97_255/0.35),0_8px_24px_-8px_rgb(123_97_255/0.25)]';

    const iconInputPad = icon ? (appearance === 'minimal' ? 'pl-8' : 'pl-10') : '';

    const inputClassName =
      appearance === 'minimal'
        ? `${minimalInputClass} ${minimalStateClass} ${iconInputPad} ${className}`
        : `${defaultInputClass} ${defaultStateClass} ${iconInputPad} ${className}`;

    return (
      <div className="min-w-0 w-full">
        {label && (
          <label
            htmlFor={inputId}
            className={`mb-1 block font-medium text-[var(--foreground)] ${appearance === 'minimal' ? 'text-xs tracking-wide text-[var(--text-muted)]' : 'text-sm'} ${labelClassName ?? ''}`}
          >
            {label}
          </label>
        )}
        <div className="relative min-w-0">
          {icon && (
            <div
              className={`pointer-events-none absolute inset-y-0 left-0 flex items-center text-[var(--text-muted)] ${appearance === 'default' ? 'pl-3' : ''}`}
            >
              {icon}
            </div>
          )}
          <input ref={ref} id={inputId} className={inputClassName} {...props} />
        </div>
        {hint && !error && <p className="mt-1 text-xs text-[var(--text-muted)]">{hint}</p>}
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
export default Input;
