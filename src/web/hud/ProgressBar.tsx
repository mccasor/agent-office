import type { ContextLevel } from './format';
import './hud.css';

interface ProgressBarProps {
  /** 0..100 */
  value: number;
  label: string;
  level?: ContextLevel;
  className?: string;
}

export function ProgressBar({ value, label, level, className }: ProgressBarProps) {
  return (
    <div
      className={['hud-bar', className].filter(Boolean).join(' ')}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      data-level={level}
    >
      <div className="hud-bar__fill" style={{ width: `${value}%` }} />
    </div>
  );
}
