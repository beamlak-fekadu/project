import { type ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: ReactNode;
  trend?: { value: number; label: string };
  color?: string;
  onClick?: () => void;
  active?: boolean;
}

export default function StatCard({ label, value, icon, trend, color = 'blue', onClick, active = false }: StatCardProps) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-500/15 text-blue-300',
    green: 'bg-emerald-500/15 text-emerald-300',
    red: 'bg-rose-500/15 text-rose-300',
    yellow: 'bg-amber-500/15 text-amber-300',
    purple: 'bg-violet-500/15 text-violet-300',
    orange: 'bg-orange-500/15 text-orange-300',
    gray: 'bg-slate-500/15 text-slate-300',
  };

  return (
    <div
      className={`panel-surface rounded-lg p-5 transition-colors ${onClick ? 'cursor-pointer hover:border-[var(--brand)]/50' : ''} ${active ? 'ring-2 ring-[var(--brand)]' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-[var(--text-muted)]">{label}</p>
          <p className="mt-1 text-2xl font-bold text-[var(--foreground)]">{value}</p>
          {trend && (
            <p className={`mt-1 text-xs font-medium ${trend.value >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
              {trend.value >= 0 ? '+' : ''}{trend.value}% {trend.label}
            </p>
          )}
        </div>
        <div className={`rounded-lg p-3 ${colorMap[color] || colorMap.blue}`}>{icon}</div>
      </div>
    </div>
  );
}
