import type { ReactNode } from 'react';
import type { RepoState, SessionState } from '../../shared/types';
import { contextLevel, formatTokens, percent } from './format';
import { ProgressBar } from './ProgressBar';
import './hud.css';

const DASH = '—';

/** Contenitore fisso dei pannelli: colonna in alto a sinistra, `side="right"` per l'alto a destra. */
export function HudOverlay({ children, side = 'left' }: { children?: ReactNode; side?: 'left' | 'right' }) {
  return <div className={`hud-overlay hud-overlay--${side}`}>{children}</div>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="hud-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Pannello overlay: modello, effort, contesto (barra), token usati/rimanenti. */
export function SessionPanel({ session }: { session: SessionState | null }) {
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
      <dl>
        <Row label="Modello">{session.model ?? DASH}</Row>
        <Row label="Effort">{session.effort ?? DASH}</Row>
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
        <Row label="Token usati">
          <span data-testid="tokens-used">{formatTokens(session.tokensUsed.total)}</span>
        </Row>
        <Row label="Rimanenti">
          <span data-testid="tokens-left">{session.tokensLeft === null ? DASH : formatTokens(session.tokensLeft)}</span>
        </Row>
      </dl>
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
      <div className="hud-diff">
        <span className="hud-added">{`+${repo.linesAdded}`}</span>
        <span className="hud-removed">{`-${repo.linesRemoved}`}</span>
        <span className="hud-muted">{`${repo.filesChanged} file`}</span>
      </div>
    </section>
  );
}
