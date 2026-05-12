'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'warning' | 'success' | 'info';
type Size = 'sm' | 'md' | 'lg' | 'icon';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

/**
 * Primary uses the brand gradient with a subtle inset highlight (glass).
 * Secondary/outline/ghost are translucent surfaces that adapt to glass + dark.
 */
const variantStyles: Record<Variant, string> = {
  primary:
    'bg-[image:var(--brand-gradient)] text-white shadow-[0_4px_12px_-2px_rgba(37,99,235,0.35)] hover:brightness-[1.05] focus:ring-[var(--brand)] disabled:bg-[var(--surface-3)] disabled:bg-none disabled:text-[var(--text-muted)] disabled:shadow-none disabled:opacity-100',
  secondary:
    'bg-[var(--surface-3)] text-[var(--foreground)] hover:bg-[var(--surface-1)] focus:ring-[var(--brand)]',
  outline:
    'border border-[var(--border-subtle)] bg-[var(--surface-1)] text-[var(--foreground)] backdrop-blur hover:bg-[var(--surface-3)] focus:ring-[var(--brand)]',
  ghost:
    'text-[var(--text-muted)] hover:bg-[var(--surface-1)] hover:text-[var(--foreground)] focus:ring-[var(--brand)]',
  destructive:
    'bg-[var(--danger)] text-white hover:brightness-110 focus:ring-[var(--danger)]',
  warning:
    'bg-[var(--warning)] text-white hover:brightness-110 focus:ring-[var(--warning)]',
  success:
    'bg-[var(--success)] text-white hover:brightness-110 focus:ring-[var(--success)]',
  info:
    'bg-[var(--brand)] text-white hover:brightness-110 focus:ring-[var(--brand)]',
};

const sizeStyles: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
  icon: 'p-2',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, className = '', disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-medium tracking-tight transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-0 disabled:cursor-not-allowed ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      {...props}
    >
      {loading && (
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </button>
  )
);

Button.displayName = 'Button';
export default Button;
