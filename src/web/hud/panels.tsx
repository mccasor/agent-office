import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { OfficeStatus, RepoDiff, SessionState } from '../../shared/types';
import { DOT_LABEL, waitingText } from './labels';
import { useNow } from './useNow';
import './hud.css';

/** Contenitore fisso unico (in body) per tutti gli overlay: affiancati su desktop, impilati sotto 680px. */
function hudStack(): HTMLElement {
  let el = document.querySelector<HTMLElement>('body > .hud-stack');
  if (!el) {
    el = document.createElement('div');
    el.className = 'hud-stack';
    document.body.appendChild(el);
  }
  return el;
}

/** Colonna di pannelli: in alto a sinistra, `side="right"` per l'alto a destra. */
export function HudOverlay({ children, side = 'left' }: { children?: ReactNode; side?: 'left' | 'right' }) {
  return createPortal(<div className={`hud-overlay hud-overlay--${side}`}>{children}</div>, hudStack());
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="hud-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Righe aggiunte e tolte, file modificati (modifiche non committate). */
export function DiffStat({ diff }: { diff: RepoDiff }) {
  return (
    <div className="hud-diff">
      <span className="hud-added">{`+${diff.linesAdded}`}</span>
      <span className="hud-removed">{`-${diff.linesRemoved}`}</span>
      <span className="hud-muted">{`${diff.filesChanged} file`}</span>
    </div>
  );
}

/**
 * Avviso della sessione (o del subagente) bloccato: motivo e da quanto ("Aspetta un tuo permesso · da 3 min");
 * con `who`, chi è bloccato ("Explore aspetta un tuo permesso · da 3 min").
 */
export function SessionAlert({ session, who = null }: {
  session: Pick<SessionState, 'waitingKind' | 'waitingSince'>;
  who?: string | null;
}) {
  const now = useNow();
  const text = waitingText(session.waitingKind, session.waitingSince, now);
  return <p className="hud-session__alert">{who ? `${who} ${text}` : text.charAt(0).toUpperCase() + text.slice(1)}</p>;
}

/** Pallino di stato con la stessa regola dell'icona nella menu bar. */
export function StatusDot({ status }: { status: OfficeStatus }) {
  return <span className={`list-dot list-dot--${status}`} role="img" aria-label={DOT_LABEL[status]} title={DOT_LABEL[status]} />;
}
