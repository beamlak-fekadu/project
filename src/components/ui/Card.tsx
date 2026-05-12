interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: boolean;
  /** Use `solid` for surfaces that need to feel opaque (modals, login card), `glass` is the default. */
  variant?: 'glass' | 'solid';
}

export default function Card({ children, className = '', padding = true, variant = 'glass' }: CardProps) {
  const base = variant === 'solid' ? 'panel-surface-solid' : 'panel-surface';
  return (
    <div className={`${base} rounded-2xl ${padding ? 'p-6' : ''} ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`mb-4 flex items-center justify-between ${className}`}>{children}</div>;
}

export function CardTitle({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <h3 className={`text-base font-semibold tracking-tight text-[var(--foreground)] ${className}`}>
      {children}
    </h3>
  );
}

export function CardDescription({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-sm leading-relaxed text-[var(--text-muted)] ${className}`}>{children}</p>;
}

export function CardContent({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}

export function CardFooter({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`mt-4 flex items-center gap-2 border-t border-[var(--border-subtle)] pt-4 ${className}`}>
      {children}
    </div>
  );
}
