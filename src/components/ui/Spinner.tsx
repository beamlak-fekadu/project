import { PageSkeleton } from './skeletons';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = { sm: 'h-4 w-4', md: 'h-8 w-8', lg: 'h-12 w-12' };

export default function Spinner({ size = 'md', className = '' }: SpinnerProps) {
  return (
    <svg className={`animate-spin text-blue-600 ${sizeMap[size]} ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// Page-level loading state. Resembles the standard dashboard layout (header +
// KPI grid + table) so perceived load time feels closer to real content than a
// centered spinner. Every existing `PageLoader` consumer inherits the upgrade.
export function PageLoader() {
  return <PageSkeleton />;
}
