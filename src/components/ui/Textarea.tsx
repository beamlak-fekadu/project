'use client';

import { forwardRef, type TextareaHTMLAttributes } from 'react';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, className = '', id, ...props }, ref) => {
    const textareaId = id || label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="min-w-0 w-full">
        {label && (
          <label htmlFor={textareaId} className="mb-1 block text-sm font-medium text-[var(--foreground)]">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={`block min-h-24 w-full min-w-0 rounded-xl border px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-70 ${
            error
              ? 'border-red-400/70 bg-[var(--surface-2)] text-[var(--foreground)] focus:border-red-400 focus:ring-red-400'
              : 'border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--foreground)] focus:border-[var(--brand)] focus:ring-[var(--brand)]'
          } ${className}`}
          rows={4}
          {...props}
        />
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';
export default Textarea;
