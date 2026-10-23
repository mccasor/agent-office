import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { AgentAlert, AgentOutcome, OfficeStatus, RepoDiff, SessionState, WorkArea } from '../../shared/types';
import { t, tn } from '../../shared/i18n';
import { useShow } from '../store';
import { contextLevel, formatTokens, percent } from './format';
import { alertText, AREA_LABEL, compactionText, DOT_LABEL, OUTCOME_LABEL, projectName, waitingText } from './labels';
import { ProgressBar } from './ProgressBar';
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

/** Righe aggiunte e tolte, file modificati (modifiche non committate); nascosta dalle impostazioni (`session.diff`). */
export function DiffStat({ diff }: { diff: RepoDiff }) {
  if (!useShow('session.diff')) return null;
  return (
    <div className="hud-diff">
      <span className="hud-added">{`+${diff.linesAdded}`}</span>
      <span className="hud-removed">{`-${diff.linesRemoved}`}</span>
      <span className="hud-muted">{tn('diff.files', diff.filesChanged)}</span>
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

/**
 * Avviso su un subagente fermo o in loop (#97): "!" giallo e la frase; per chi è fermo, con `onDismiss`, il
 * pulsante "Fallo uscire" (lo nasconde finché non torna attivo).
 */
export function AgentAlertNote({ alert, onDismiss }: { alert: AgentAlert; onDismiss?: () => void }) {
  const now = useNow();
  return (
    <div className="hud-alert" role="status">
      <AlertMark />
      <p>{alertText(alert, now)}</p>
      {alert.kind === 'stale' && onDismiss && (
        <button type="button" className="hud-alert__dismiss" title={t('alert.dismissHint')} onClick={onDismiss}>
          {t('alert.dismiss')}
        </button>
      )}
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

/** sotto questa percentuale il contesto è una pillola compatta, da qui una barra */
export const CONTEXT_BAR_FROM = 50;

/**
 * Contesto della sessione in una riga: sotto il 50% una pillola (`slot="inline"`, accanto alla riga meta), dal 50% una
 * barra (`slot="block"`, a tutta riga) con "conviene /compact" oltre il 90%. Token e compattazioni nel tooltip.
 */
export function ContextGauge({ session: s, slot }: { session: SessionState; slot: 'inline' | 'block' }) {
  const shown = useShow('session.context');
  const pct = percent(s.context.used, s.context.window);
  if (!shown || pct === null || (pct < CONTEXT_BAR_FROM) !== (slot === 'inline')) return null;
  const title = [`${formatTokens(s.context.used)} / ${formatTokens(s.context.window ?? 0)}`, compactionText(s.compactions, s.lastCompaction)]
    .filter(Boolean)
    .join(' · ');
  const level = contextLevel(pct);
  if (slot === 'inline') {
    return <span className="hud-pill" data-level={level} title={title}>{t('context.pill', { pct })}</span>;
  }
  return (
    <div className="list-session__context" title={title}>
      <span className="hud-muted">{t('context.pill', { pct })}</span>
      <ProgressBar value={pct} label={t('context.usedOf', { project: projectName(s) })} level={level} className="hud-bar--small" />
      {level === 'danger' && <span className="hud-context__hint">{t('compact.hint')}</span>}
    </div>
  );
}
