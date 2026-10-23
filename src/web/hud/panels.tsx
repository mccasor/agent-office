import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { AgentAlert, AgentOutcome, OfficeStatus, RepoDiff, SessionState, WorkArea } from '../../shared/types';
import { t, tn } from '../../shared/i18n';
import { useShow, useShown } from '../store';
import { contextLevel, formatTokens, percent } from './format';
import { alertText, AREA_LABEL, compactionText, DOT_LABEL, OUTCOME_LABEL, projectName, waitingText } from './labels';
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
    <span className={`hud-chip hud-chip--${area}`} data-area={area} title={t('role.title', { role: AREA_LABEL[area] })}>
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

/** quadratini della barra del diff, come su GitHub: verdi e rossi in proporzione alle righe aggiunte e tolte */
const DIFF_BLOCKS = 5;

/** Quadratini verdi e rossi in proporzione alle righe aggiunte e tolte; grigi senza righe. Pura nei conti. */
export function diffBlocks(diff: RepoDiff): ('added' | 'removed' | 'none')[] {
  const total = diff.linesAdded + diff.linesRemoved;
  if (total === 0) return Array<'none'>(DIFF_BLOCKS).fill('none');
  const added = Math.round((diff.linesAdded / total) * DIFF_BLOCKS);
  return Array.from({ length: DIFF_BLOCKS }, (_, i) => (i < added ? 'added' : 'removed'));
}

/** Righe aggiunte e tolte, file modificati (modifiche non committate) e la barra a quadratini. */
function DiffLine({ diff }: { diff: RepoDiff }) {
  return (
    <div className="hud-diff" title={t('git.uncommitted')}>
      <span className="hud-added">{`+${diff.linesAdded}`}</span>
      <span className="hud-removed">{`-${diff.linesRemoved}`}</span>
      <span className="hud-diff__blocks" aria-hidden="true">
        {diffBlocks(diff).map((kind, i) => <i key={i} data-kind={kind} />)}
      </span>
      <span className="hud-muted">{tn('diff.files', diff.filesChanged)}</span>
    </div>
  );
}

/** Logo di git (il rombo con i rami), nel colore della sezione. */
function GitIcon() {
  return (
    <svg className="hud-git__icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M15.7 7.3 8.7.3a1 1 0 0 0-1.4 0L5.8 1.8l1.8 1.8a1.2 1.2 0 0 1 1.5 1.5l1.8 1.8a1.2 1.2 0 1 1-.7.7L8.5 5.9v4.4a1.2 1.2 0 1 1-1-.1V5.8a1.2 1.2 0 0 1-.6-1.6L5.1 2.5.3 7.3a1 1 0 0 0 0 1.4l7 7a1 1 0 0 0 1.4 0l7-7a1 1 0 0 0 0-1.4Z" />
    </svg>
  );
}

/**
 * Sezione "Git" dell'istanza, nell'arancione di git: branch, issue (dal nome del branch) e modifiche non committate
 * (righe e file). Ogni riga segue la sua voce delle impostazioni; senza nulla da mostrare la sezione non c'è.
 */
export function GitSection({ session: s }: { session: Pick<SessionState, 'branch' | 'issues' | 'diff'> }) {
  const show = useShown();
  const branch = s.branch && show('session.branch') ? s.branch : null;
  const issues = show('session.issues') ? s.issues : [];
  const diff = s.diff && show('session.diff') ? s.diff : null;
  if (!branch && issues.length === 0 && !diff) return null;
  return (
    <section className="hud-git" aria-label={t('git.title')}>
      <div className="hud-git__head">
        <GitIcon />
        <span>{t('git.title')}</span>
      </div>
      {(branch || issues.length > 0) && (
        <div className="hud-git__row">
          {branch && <span className="hud-git__branch" title={branch}>{branch}</span>}
          {issues.map((n) => <span key={n} className="hud-label__issue">{`#${n}`}</span>)}
        </div>
      )}
      {diff && <DiffLine diff={diff} />}
    </section>
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

/**
 * Avviso su un subagente fermo o in loop (#97): "!" giallo e la frase; per chi è fermo, la frase invita a usare
 * "Controlla stato" (#104), che nella scheda sta subito sotto.
 */
export function AgentAlertNote({ alert }: { alert: AgentAlert }) {
  const now = useNow();
  return (
    <div className="hud-alert" role="status">
      <AlertMark />
      <p>{alertText(alert, now)}</p>
    </div>
  );
}

/** "!" giallo dell'avviso, lo stesso sopra la testa nell'ufficio. */
export function AlertMark({ title }: { title?: string }) {
  return <span className="hud-alert__mark" aria-hidden={title ? undefined : true} title={title}>!</span>;
}

/** Esito di un terminato (#97): ok, interrotto, fallito, colorato. */
export function OutcomeTag({ outcome }: { outcome: AgentOutcome }) {
  return <span className={`hud-outcome hud-outcome--${outcome}`}>{OUTCOME_LABEL[outcome]}</span>;
}

/** Pallino di stato con la stessa regola dell'icona nella menu bar. */
export function StatusDot({ status }: { status: OfficeStatus }) {
  return <span className={`list-dot list-dot--${status}`} role="img" aria-label={DOT_LABEL[status]} title={DOT_LABEL[status]} />;
}

/** Pulsante "apri in una finestra" (#92): una finestra con la freccia verso l'esterno. */
export function PopOutButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="hud-popout" aria-label={label} title={label} onClick={onClick}>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 3H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9" />
        <path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5" />
      </svg>
    </button>
  );
}

/**
 * Contesto della sessione: etichetta, token usati sulla finestra e percentuale sopra una barra con le zone
 * colorate (arancione dal 70%, rosso dal 90%, come contextLevel); la barra prende il colore della zona in cui arriva.
 * Oltre il 90% "conviene /compact"; con `compactions` anche quante volte è stato compattato.
 */
export function ContextMeter({ session: s, compactions = false }: { session: SessionState; compactions?: boolean }) {
  const shown = useShow('session.context');
  const pct = percent(s.context.used, s.context.window);
  if (!shown || pct === null) return null;
  const level = contextLevel(pct);
  const compacted = compactions ? compactionText(s.compactions, s.lastCompaction) : null;
  return (
    <div className="hud-ctx" data-level={level}>
      <div className="hud-ctx__head">
        <span className="hud-ctx__label">{t('card.context')}</span>
        <span className="hud-ctx__tokens hud-muted">{`${formatTokens(s.context.used)} / ${s.context.window === null ? '?' : formatTokens(s.context.window)}`}</span>
        <span className="hud-ctx__pct">{`${pct}%`}</span>
      </div>
      <div
        className="hud-ctx__track"
        role="progressbar"
        aria-label={t('context.usedOf', { project: projectName(s) })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="hud-ctx__fill" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      {level === 'danger' && <p className="hud-ctx__note hud-context__hint">{t('compact.hint')}</p>}
      {compacted && <p className="hud-ctx__note hud-muted">{compacted.charAt(0).toUpperCase() + compacted.slice(1)}</p>}
    </div>
  );
}
