import type { ContextLevel } from './format';
import './hud.css';

interface ProgressBarProps {
  /** 0..100; null = indeterminata (animata, senza aria-valuenow) */
  value: number | null;
  label: string;
  level?: ContextLevel;
  className?: string;
}

export function ProgressBar({ value, label, level, className }: ProgressBarProps) {
  const indeterminate = value === null;
  const cls = ['hud-bar', indeterminate && 'hud-bar--indeterminate', className].filter(Boolean).join(' ');
  return (
    <div
      className={cls}
      role="progressbar"
      aria-label={label}
      aria-valuemin={indeterminate ? undefined : 0}
      aria-valuemax={indeterminate ? undefined : 100}
      aria-valuenow={indeterminate ? undefined : value}
      data-level={level}
    >
      <div className="hud-bar__fill" style={indeterminate ? undefined : { width: `${value}%` }} />
    </div>
  );
}
