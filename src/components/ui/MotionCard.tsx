'use client';

import { motion, type HTMLMotionProps } from 'framer-motion';
import { forwardRef, type ReactNode } from 'react';
import { cardItem, subtleHover } from '@/lib/ui/motion-presets';

// Motion-aware wrapper around the BMEDIS panel surface. Designed to drop into
// stagger lists (use with `cardStagger` on the parent) without breaking the
// existing glass `panel-surface` look.
//
// This does NOT replace `Card`; it's a thin motion-enabled alternative for
// dashboards and command-center grids where reveal/hover motion is desired.

type MotionCardProps = HTMLMotionProps<'div'> & {
  children: ReactNode;
  /** Adds subtle lift on hover/tap (default true). */
  interactive?: boolean;
  /** Use compact padding (`p-4`) instead of `p-5`. */
  compact?: boolean;
};

const MotionCard = forwardRef<HTMLDivElement, MotionCardProps>(function MotionCard(
  { children, className, interactive = true, compact = false, ...rest },
  ref,
) {
  const padding = compact ? 'p-4' : 'p-5';
  return (
    <motion.div
      ref={ref}
      variants={cardItem}
      {...(interactive ? subtleHover : {})}
      className={`panel-surface min-w-0 rounded-2xl ${padding} ${className ?? ''}`.trim()}
      {...rest}
    >
      {children}
    </motion.div>
  );
});

export default MotionCard;
