export function formatPercentage(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

export function formatCount(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return Math.round(value).toLocaleString();
}

export function formatScore(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
}
