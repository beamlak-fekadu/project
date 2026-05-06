import { type ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: ReactNode;
  trend?: { value: number; label: string };
  color?: string;
  onClick?: () => void;
}

export default function StatCard({ label, value, icon, trend, color = 'blue', onClick }: StatCardProps) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-500/15 text-blue-700 dark:text-blue-200',
    green: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-200',
    red: 'bg-rose-500/15 text-rose-700 dark:text-rose-200',
    yellow: 'bg-amber-500/15 text-amber-700 dark:text-amber-200',
    purple: 'bg-violet-500/15 text-violet-700 dark:text-violet-200',
    orange: 'bg-orange-500/15 text-orange-700 dark:text-orange-200',
    gray: 'bg-slate-500/15 text-slate-700 dark:text-slate-200',
  };

  return (
    <div
      className={`panel-surface rounded-2xl p-5 transition-shadow ${onClick ? 'cursor-pointer hover:shadow-lg' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-[var(--text-muted)]">{label}</p>
          <p className="mt-1 text-2xl font-bold text-[var(--foreground)]">{value}</p>
          {trend && (
            <p className={`mt-1 text-xs font-medium ${trend.value >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
              {trend.value >= 0 ? '+' : ''}{trend.value}% {trend.label}
            </p>
          )}
        </div>
        <div className={`rounded-lg p-3 ${colorMap[color] || colorMap.blue}`}>{icon}</div>
      </div>
    </div>
  );
}
