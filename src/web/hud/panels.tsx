import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { OfficeStatus, RepoDiff, RepoState, SessionState, WorkArea } from '../../shared/types';
import { AREA_LABEL, DOT_LABEL, waitingText } from './labels';
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

/** Etichetta colorata del ruolo (#88): stesso colore dell'area nel 2D, nella scheda, nell'accordion e nella lista. */
export function RoleChip({ area }: { area: WorkArea }) {
  return (
    <span className={`hud-chip hud-chip--${area}`} data-area={area} title={`Ruolo: ${AREA_LABEL[area]}`}>
      {AREA_LABEL[area]}
    </span>
  );
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

/** Pannello overlay: progetto, branch, +righe / -righe, file modificati. */
export function RepoPanel({ repo }: { repo: RepoState | null }) {
  if (!repo) {
    return (
      <section className="hud-panel hud-panel--empty" aria-label="Repository">
        Nessun repository git
      </section>
    );
  }
  return (
    <section className="hud-panel" aria-label="Repository">
      <div className="hud-title">{repo.project}</div>
      <div className="hud-branch">{repo.branch ?? '(detached)'}</div>
      <DiffStat diff={repo} />
    </section>
  );
}
