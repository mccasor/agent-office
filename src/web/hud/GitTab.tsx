import { type ReactNode, useEffect, useMemo, useState } from 'react';
import type { GitCommit, GitDayReport } from '../../shared/types';
import { clock, t, tn, type TextKey } from '../../shared/i18n';
import { useShow } from '../store';
import { authorColors, authorKey, authorLabel, byHour, byType, summarize, topFiles } from './gitStats';
import { requestedTab, tabKey, type InstanceTab } from './popout';
import { useNow } from './useNow';
import './hud.css';
import './git.css';

/*
 * Scheda "Git" delle informazioni sull'istanza (#109): commit del giorno con chi li ha fatti (Claude, un subagente o
 * fuori da Claude), file più toccati, righe per ora e tipi di file, con il selettore del giorno come nella vista
 * Analisi. I dati arrivano da /api/git solo a scheda aperta; oggi si aggiornano col ticchettio di useNow.
 */

export type GitLoader = (sessionId: string, day: string | null) => Promise<GitDayReport>;

/** Di chi mostrare i commit nella scheda di un personaggio: Claude stesso (della sua sessione) o un subagente. */
export type GitAuthorFilter = { kind: 'claude'; sessionId: string } | { kind: 'agent'; agentId: string };

/**
 * Solo i commit di `author`, per la scheda aperta cliccando un personaggio dell'ufficio; l'istanza li mostra tutti.
 * Un commit di Claude senza sessione (server vecchio) vale per qualunque Claude. Pura.
 */
export function onlyAuthor(report: GitDayReport, author: GitAuthorFilter): GitDayReport {
  const mine = (c: GitCommit) => {
    const a = c.author;
    if (author.kind === 'agent') return a.kind === 'agent' && a.agentId === author.agentId;
    return a.kind === 'claude' && (a.sessionId === undefined || a.sessionId === author.sessionId);
  };
  return { ...report, commits: report.commits.filter(mine) };
}

/** Commit del giorno di un'istanza dal server; null = oggi. */
export const fetchGit: GitLoader = async (sessionId, day) => {
  const q = new URLSearchParams({ session: sessionId, ...(day ? { day } : {}) });
  const res = await fetch(`/api/git?${q}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const report: unknown = await res.json();
  if (!isReport(report)) throw new Error('risposta non valida');
  return report;
};

/** Risposta di /api/git con la forma attesa (server vecchio o risposta estranea: no). Pura. */
export function isReport(v: unknown): v is GitDayReport {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Partial<GitDayReport>;
  return typeof r.day === 'string' && Array.isArray(r.days) && typeof r.status === 'string' && Array.isArray(r.commits);
}

/** Riepilogo di un giorno (null = oggi, riletto a ogni ticchettio); `enabled` falso: niente richieste. */
function useGitReport(sessionId: string, day: string | null, load: GitLoader, enabled = true) {
  const now = useNow();
  const [report, setReport] = useState<GitDayReport | null>(null);
  const [failed, setFailed] = useState(false);
  const tick = day === null ? now : 0;
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    load(sessionId, day).then(
      (r) => {
        if (!live) return;
        setReport(r);
        setFailed(false);
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [sessionId, day, tick, load, enabled]);
  return { report, failed };
}

/** Frase dello stato vuoto, o null se ci sono commit da mostrare. Pura. */
export function emptyText(report: GitDayReport): string | null {
  const key: Record<Exclude<GitDayReport['status'], 'ok'>, TextKey> = { 'not-repo': 'gitTab.notRepo', 'no-git': 'gitTab.noGit', empty: 'gitTab.empty' };
  if (report.status !== 'ok') return t(key[report.status]);
  return report.commits.length === 0 ? t('gitTab.noCommits') : null;
}

/** +righe −righe */
function Lines({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="git-lines">
      <span className="hud-added">{`+${added}`}</span>
      <span className="hud-removed">{`−${removed}`}</span>
    </span>
  );
}

/** Barra divisa per autore (in proporzione ai commit) e legenda con i numeri. */
function AuthorBar({ commits }: { commits: GitCommit[] }) {
  const { authors } = summarize(commits);
  const total = Math.max(1, commits.length);
  return (
    <>
      <div className="git-authors__bar" role="img" aria-label={authors.map((a) => `${a.label}: ${tn('gitTab.commits', a.count)}`).join(', ')}>
        {authors.map((a) => <span key={a.key} style={{ width: `${(a.count / total) * 100}%`, background: a.color }} title={`${a.label} · ${tn('gitTab.commits', a.count)}`} />)}
      </div>
      <ul className="git-authors__legend">
        {authors.map((a) => (
          <li key={a.key} title={a.title}>
            <i style={{ background: a.color }} />
            <span className="git-authors__name">{a.label}</span>
            <span className="hud-muted">{a.count}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Riepilogo del giorno: commit, righe, file toccati e barra per autore. */
export function GitSummary({ commits }: { commits: GitCommit[] }) {
  const s = summarize(commits);
  return (
    <section className="git-block git-summary" aria-label={t('gitTab.summary')}>
      <p className="git-summary__line">
        <strong>{tn('gitTab.commits', s.commits)}</strong>
        <Lines added={s.added} removed={s.removed} />
        <span className="hud-muted">{tn('gitTab.files', s.files)}</span>
      </p>
      <AuthorBar commits={commits} />
    </section>
  );
}

const MATCH_HINT: Record<NonNullable<GitCommit['matchedBy']>, TextKey> = { hash: 'gitTab.byHash', message: 'gitTab.byMessage', time: 'gitTab.byTime' };

/** Un commit: ora, autore, messaggio, righe e file; aperto, i file con le loro righe. */
function CommitRow({ commit: c, color, branch }: { commit: GitCommit; color: string; branch: string | null }) {
  const author = authorLabel(c.author);
  const hint = c.author.kind === 'agent' ? `${author} (${c.author.agentType})` : c.author.kind === 'outside' ? t('gitTab.outsideHint') : author;
  return (
    <li className="git-commit">
      <details>
        <summary>
          <time className="hud-muted">{clock(c.at)}</time>
          <span className="git-commit__author" style={{ color }} title={c.matchedBy ? `${hint} · ${t(MATCH_HINT[c.matchedBy])}` : hint}>{author}</span>
          <span className="git-commit__msg" title={c.message}>{c.message}</span>
          <span className="git-commit__stats">
            <Lines added={c.added} removed={c.removed} />
            <span className="hud-muted">{tn('gitTab.files', c.filesCount)}</span>
          </span>
          <span className="git-commit__meta hud-muted">
            <code>{c.hash}</code>
            {c.branch && c.branch !== branch && <span className="git-commit__branch" title={t('gitTab.otherBranch')}>{c.branch}</span>}
          </span>
        </summary>
        <ul className="git-commit__files">
          {c.files.map((f) => (
            <li key={f.path}>
              <span className="git-commit__file" title={f.path}>{f.path}</span>
              {f.binary ? <span className="hud-muted">{t('gitTab.binary')}</span> : <Lines added={f.added} removed={f.removed} />}
            </li>
          ))}
          {c.filesCount > c.files.length && <li className="hud-muted">{t('gitTab.moreFiles', { n: c.filesCount - c.files.length })}</li>}
        </ul>
      </details>
    </li>
  );
}

function CommitList({ commits, branch, truncated }: { commits: GitCommit[]; branch: string | null; truncated: boolean }) {
  const colors = authorColors(commits);
  return (
    <section className="git-block" aria-label={t('gitTab.list')}>
      <h3>{t('gitTab.list')}</h3>
      <ul className="git-commits">
        {commits.map((c) => <CommitRow key={c.hash} commit={c} color={colors.get(authorKey(c.author))!} branch={branch} />)}
      </ul>
      {truncated && <p className="hud-muted git-note">{t('gitTab.truncated', { n: commits.length })}</p>}
    </section>
  );
}

/** File più toccati: barre orizzontali per numero di commit, basename con il percorso nel tooltip, righe a fianco. */
function TopFiles({ commits }: { commits: GitCommit[] }) {
  const files = topFiles(commits);
  const max = Math.max(1, ...files.map((f) => f.commits));
  return (
    <section className="git-block" aria-label={t('gitTab.topFiles')}>
      <h3 title={t('gitTab.topFilesHint')}>{t('gitTab.topFiles')}</h3>
      <ul className="git-bars">
        {files.map((f) => (
          <li key={f.path} title={`${f.path} · ${tn('gitTab.commits', f.commits)}`}>
            <span className="git-bars__name">{f.name}</span>
            <span className="git-bars__track"><span className="git-bars__fill" style={{ width: `${(f.commits / max) * 100}%` }} /></span>
            <span className="git-bars__value">{f.commits}</span>
            <Lines added={f.added} removed={f.removed} />
          </li>
        ))}
      </ul>
    </section>
  );
}

const CHART_W = 240;
const CHART_H = 64;
const MID = CHART_H / 2;
const SLOT = CHART_W / 24;

/** Istogramma per ora del giorno: righe aggiunte sopra la linea, tolte sotto, in SVG. */
function HoursChart({ commits }: { commits: GitCommit[] }) {
  const hours = byHour(commits);
  const max = Math.max(1, ...hours.map((h) => Math.max(h.added, h.removed)));
  const height = (n: number) => (n === 0 ? 0 : Math.max(1, (n / max) * (MID - 2)));
  return (
    <section className="git-block" aria-label={t('gitTab.hours')}>
      <h3>{t('gitTab.hours')}</h3>
      <svg className="git-hours" viewBox={`0 0 ${CHART_W} ${CHART_H + 10}`} role="img" aria-label={t('gitTab.hoursAria')}>
        <line className="git-hours__axis" x1={0} x2={CHART_W} y1={MID} y2={MID} />
        {hours.map((h, i) => (
          <g key={i}>
            <title>{t('gitTab.hour', { h: i, added: h.added, removed: h.removed })}</title>
            {/* fascia trasparente per il tooltip anche sulle ore vuote */}
            <rect x={i * SLOT} y={0} width={SLOT} height={CHART_H} fill="transparent" />
            <rect className="git-hours__added" x={i * SLOT + 1.5} y={MID - height(h.added)} width={SLOT - 3} height={height(h.added)} rx={1} />
            <rect className="git-hours__removed" x={i * SLOT + 1.5} y={MID} width={SLOT - 3} height={height(h.removed)} rx={1} />
          </g>
        ))}
        {[0, 6, 12, 18].map((h) => (
          <text key={h} className="git-hours__label" x={h * SLOT + 1} y={CHART_H + 8}>{h}</text>
        ))}
      </svg>
    </section>
  );
}

/** Tipi di file: barra delle righe (aggiunte e tolte) per estensione, con le modifiche ai file. */
function FileTypes({ commits }: { commits: GitCommit[] }) {
  const types = byType(commits);
  const max = Math.max(1, ...types.map((x) => x.added + x.removed));
  return (
    <section className="git-block" aria-label={t('gitTab.types')}>
      <h3>{t('gitTab.types')}</h3>
      <ul className="git-bars">
        {types.map((x) => (
          <li key={x.ext} title={`+${x.added} −${x.removed}`}>
            <span className="git-bars__name">{x.ext || t('gitTab.noExt')}</span>
            <span className="git-bars__track">
              <span className="git-bars__fill git-bars__fill--added" style={{ width: `${(x.added / max) * 100}%` }} />
              <span className="git-bars__fill git-bars__fill--removed" style={{ width: `${(x.removed / max) * 100}%` }} />
            </span>
            <span className="git-bars__value hud-muted">{tn('gitTab.files', x.files)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Contenuto di un giorno: stato vuoto, oppure riepilogo, commit e grafici. Pura. */
export function GitDayView({ report, own = false }: { report: GitDayReport; own?: boolean }) {
  const empty = own && report.status === 'ok' && report.commits.length === 0 ? t('gitTab.noCommitsOwn') : emptyText(report);
  if (empty) return <p className="git-empty" role="status">{empty}</p>;
  return (
    <>
      <GitSummary commits={report.commits} />
      <CommitList commits={report.commits} branch={report.branch} truncated={report.truncated} />
      <TopFiles commits={report.commits} />
      <HoursChart commits={report.commits} />
      <FileTypes commits={report.commits} />
    </>
  );
}

/** Selettore del giorno come nella vista Analisi: solo se c'è più di un giorno; oggi vale null. */
function DayPicker({ report, day, onChange }: { report: GitDayReport; day: string | null; onChange: (day: string | null) => void }) {
  const today = report.days[0] ?? null;
  if (report.days.length < 2) return null;
  return (
    <label className="git-day">
      {t('gitTab.day')}
      <select value={day ?? report.day} onChange={(e) => onChange(e.target.value === today ? null : e.target.value)}>
        {report.days.map((d) => <option key={d} value={d}>{d === today ? `${d} (${t('gitTab.today')})` : d}</option>)}
      </select>
    </label>
  );
}

/**
 * Scheda Git di un'istanza (o, con `author`, di un suo personaggio): selettore del giorno e contenuto, che oltre
 * un'altezza massima scorre.
 */
export function GitPanel({ sessionId, author, load = fetchGit }: { sessionId: string; author?: GitAuthorFilter; load?: GitLoader }) {
  /** null = oggi */
  const [day, setDay] = useState<string | null>(null);
  const { report: all, failed } = useGitReport(sessionId, day, load);
  const report = useMemo(() => (all && author ? onlyAuthor(all, author) : all), [all, author]);
  return (
    <div className="git-tab">
      {report && <DayPicker report={report} day={day} onChange={setDay} />}
      {!report && <p className="git-empty" role="status">{failed ? t('gitTab.error') : t('gitTab.loading')}</p>}
      {report && (
        <div className="git-tab__scroll">
          <GitDayView report={report} own={author !== undefined} />
        </div>
      )}
    </div>
  );
}

/**
 * Riepilogo di oggi per l'accordion della lista: commit, righe, barra per autore e il pulsante per aprire la scheda
 * Git. Niente se la voce è spenta, se la cartella non è un repository o se oggi non ci sono commit.
 */
export function GitTodayLine({ sessionId, load = fetchGit, onOpen }: { sessionId: string; load?: GitLoader; onOpen?: () => void }) {
  const shown = useShow('session.gitTab');
  const { report } = useGitReport(sessionId, null, load, shown);
  if (!shown || !report || emptyText(report)) return null;
  const s = summarize(report.commits);
  return (
    <div className="git-today" aria-label={t('gitTab.summary')}>
      <span className="git-today__text">
        <strong>{tn('gitTab.commits', s.commits)}</strong>
        <Lines added={s.added} removed={s.removed} />
      </span>
      <span className="git-authors__bar git-today__bar" aria-hidden="true">
        {s.authors.map((a) => <span key={a.key} style={{ width: `${(a.count / Math.max(1, s.commits)) * 100}%`, background: a.color }} title={`${a.label} · ${a.count}`} />)}
      </span>
      {onOpen && <button type="button" className="hud-action" title={t('gitTab.openHint')} onClick={onOpen}>{t('gitTab.open')}</button>}
    </div>
  );
}

/**
 * Le due schede delle informazioni sull'istanza: "Istanza" (il contenuto di sempre, `children`) e "Git". Con la
 * voce spenta nelle impostazioni resta solo il contenuto. `watch`: segue le richieste di scheda delle altre finestre
 * (popout.requestTab), per la finestra staccata.
 */
export function InstanceTabs({ sessionId, children, initial = 'instance', watch = false, author, load }: {
  sessionId: string;
  children: ReactNode;
  initial?: InstanceTab;
  watch?: boolean;
  /** scheda di un personaggio: solo i suoi commit; un subagente ha "Agente" al posto di "Istanza" */
  author?: GitAuthorFilter;
  load?: GitLoader;
}) {
  const shown = useShow('session.gitTab');
  const [tab, setTab] = useState<InstanceTab>(() => {
    if (!watch) return initial;
    try {
      return requestedTab(localStorage.getItem(tabKey(sessionId))) ?? initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    if (!watch) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== tabKey(sessionId)) return;
      const next = requestedTab(e.newValue);
      if (next) setTab(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [watch, sessionId]);
  if (!shown) return <>{children}</>;
  const id = `tabs-${sessionId.replace(/[^\w-]/g, '_')}`;
  const button = (value: InstanceTab, label: string) => (
    <button
      type="button"
      role="tab"
      id={`${id}-${value}`}
      aria-selected={tab === value}
      aria-controls={`${id}-panel`}
      className="git-tabs__tab"
      onClick={() => setTab(value)}
    >
      {label}
    </button>
  );
  return (
    <>
      <div className="git-tabs" role="tablist" aria-label={t('gitTab.tabs')}>
        {button('instance', author?.kind === 'agent' ? t('gitTab.agent') : t('gitTab.instance'))}
        {button('git', t('gitTab.git'))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`}>
        {tab === 'instance' ? children : <GitPanel sessionId={sessionId} author={author} load={load} />}
      </div>
    </>
  );
}
