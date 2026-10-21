import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { OfficeStatus, RepoDiff, RepoState, SessionState } from '../../shared/types';
import { contextLevel, formatTokens, percent } from './format';
import { ProgressBar } from './ProgressBar';
import { TokenBreakdown } from './TokenBreakdown';
import './hud.css';

const DASH = '—';

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

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="hud-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const DOT_LABEL: Record<OfficeStatus, string> = {
  waiting: 'in attesa di un tuo input',
  working: 'al lavoro',
  idle: 'non attivo',
};

/** Nome del progetto: ultima cartella del cwd, altrimenti l'inizio dell'id. */
export const projectName = (s: SessionState): string => s.cwd?.split('/').filter(Boolean).at(-1) ?? s.id.slice(0, 8);

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

/** Pallino di stato con la stessa regola dell'icona nella menu bar. */
export function StatusDot({ status }: { status: OfficeStatus }) {
  return <span className={`list-dot list-dot--${status}`} role="img" aria-label={DOT_LABEL[status]} title={DOT_LABEL[status]} />;
}

/**
 * Pannello overlay della sessione mostrata: progetto con pallino di stato e branch, modello, effort, issue,
 * contesto (barra), token generati e ripartizione completa.
 */
export function SessionPanel({ session, status = 'idle' }: { session: SessionState | null; status?: OfficeStatus }) {
  if (!session) {
    return (
      <section className="hud-panel hud-panel--empty" aria-label="Sessione">
        Nessuna sessione attiva
      </section>
    );
  }
  const { used, window } = session.context;
  const pct = percent(used, window);
  return (
    <section className="hud-panel" aria-label="Sessione">
      <header className="hud-session">
        <StatusDot status={status} />
        <span className="hud-title">{projectName(session)}</span>
        {session.branch && <span className="hud-muted hud-session__branch">{session.branch}</span>}
      </header>
      {session.waiting && <p className="hud-session__alert">Aspetta un tuo input</p>}
      {session.diff && <DiffStat diff={session.diff} />}
      <dl>
        <Row label="Modello">{session.model ?? DASH}</Row>
        <Row label="Effort">{session.effort ?? DASH}</Row>
        <Row label="Issue">{session.issues.length > 0 ? session.issues.map((n) => `#${n}`).join(' ') : DASH}</Row>
      </dl>
      <div className="hud-context">
        <div className="hud-context__head">
          <span className="hud-muted">Contesto</span>
          <span>{`${formatTokens(used)} / ${window === null ? '?' : formatTokens(window)}`}</span>
          {pct !== null && <span className="hud-context__pct">{`${pct}%`}</span>}
        </div>
        {pct !== null && <ProgressBar value={pct} label="Contesto usato" level={contextLevel(pct)} />}
      </div>
      <dl>
        {/* il totale comprende le letture dalla cache e cresce a ogni richiesta: sta nella ripartizione */}
        <Row label="Token generati">
          <span data-testid="tokens-generated">{formatTokens(session.tokensUsed.output)}</span>
        </Row>
      </dl>
      <details className="hud-details">
        <summary>Ripartizione token</summary>
        <TokenBreakdown tokens={session.tokensUsed} />
      </details>
    </section>
  );
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
