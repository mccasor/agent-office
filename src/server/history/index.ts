import { appendFile, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { nicknameOf } from '../../shared/nickname.js';
import type {
  AgentState,
  AgentTypeStats,
  FinishedAgent,
  HistoryEvent,
  HistoryEventKind,
  HistoryReport,
  Snapshot,
  WaitStats,
  WorkArea,
} from '../../shared/types.js';
import { projectOf } from '../state/index.js';

/*
 * Storico della giornata (#98). Gli eventi si ricavano confrontando ogni snapshot pubblicato con lo stato già
 * registrato (non lo snapshot precedente): così al riavvio, quando il server rilegge i transcript e rivede gli stessi
 * agenti terminati e le stesse attese, la chiave di ogni evento è già nel file del giorno e non si conta due volte.
 * Un file JSONL per giorno (ora locale) in <dataDir>/history, solo in append: una riga troncata da un arresto
 * brusco si scarta alla lettura. I giorni oltre `keepDays` si cancellano all'avvio e al cambio di giorno.
 */

/** riga del file: l'evento più quel che serve a statistiche e terminati (mai testo dei prompt o descrizioni) */
interface HistoryRecord extends HistoryEvent {
  /** chiave di deduplica: a parità di chiave vale l'ultima riga */
  k: string;
  agentId?: string;
  startedAt?: number;
  area?: WorkArea;
  outputTokens?: number;
  cost?: number | null;
  /** basename dei file letti o modificati (agent-end, session-close) */
  files?: string[];
}

interface DayState {
  day: string;
  records: HistoryRecord[];
  /** ultima riga per chiave */
  byKey: Map<string, HistoryRecord>;
  /** attesa aperta (riga wait senza unblock) per sessione */
  openWaits: Map<string, HistoryRecord>;
  /** sessioni viste oggi: true se aperte */
  sessionOpen: Map<string, boolean>;
  /** ultima attività nota e progetto per sessione (anche di quelle sparite dallo snapshot) */
  lastAt: Map<string, number>;
  projects: Map<string, string | null>;
}

export interface History {
  /** crea la cartella, sfoltisce i giorni vecchi e ricarica la giornata in corso */
  start(): Promise<void>;
  /** confronta lo snapshot con lo storico e accoda in append gli eventi nuovi; sincrona e leggera */
  observe(snapshot: Snapshot): void;
  /** terminati di oggi delle sessioni non più attive (B5), dal più recente; undefined se nessuno */
  closedFinished(): FinishedAgent[] | undefined;
  /** riepilogo di un giorno (default oggi); null se il giorno non è valido */
  report(day?: string | null): Promise<HistoryReport | null>;
  /** attende le scritture in corso */
  flush(): Promise<void>;
}

export interface HistoryOptions {
  /** cartella dei file del giorno: <dataDir>/history */
  dir: string;
  /** giorni conservati (default 30) */
  keepDays?: number;
  /** basename dei file toccati da un subagente o da Claude stesso (agentId null) */
  filesOf?: (sessionId: string, agentId: string | null) => string[];
  now?: () => number;
}

export const KEEP_DAYS = 30;
/** righe al più per giorno: oltre si smette di registrare (la memoria non cresce senza limiti) */
export const MAX_RECORDS = 20_000;
/** eventi restituiti dalla cronologia */
export const MAX_EVENTS = 200;
/** terminati delle sessioni chiuse nello snapshot */
export const MAX_CLOSED_FINISHED = 50;
/** file più toccati restituiti */
export const MAX_FILES = 15;
/** basename salvati per agente o sessione */
const MAX_FILES_PER_RECORD = 50;
/** un agente che riprende (SendMessage) e termina di nuovo almeno N ms dopo aggiorna la sua riga di fine */
const RESUMED_MS = 60_000;

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const FILE_RE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
const KINDS = new Set<HistoryEventKind>(['agent-start', 'agent-end', 'wait', 'unblock', 'compact', 'session-open', 'session-close']);

const pad = (n: number) => String(n).padStart(2, '0');

/** Giorno in ora locale: "2026-10-23". */
export function dayOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const midnightOf = (ms: number): number => new Date(ms).setHours(0, 0, 0, 0);

const emptyDay = (day: string): DayState => ({
  day,
  records: [],
  byKey: new Map(),
  openWaits: new Map(),
  sessionOpen: new Map(),
  lastAt: new Map(),
  projects: new Map(),
});

/** Aggiorna lo stato del giorno con una riga (letta dal file o appena registrata). */
function apply(st: DayState, r: HistoryRecord): void {
  st.records.push(r);
  st.byKey.set(r.k, r);
  st.lastAt.set(r.sessionId, Math.max(st.lastAt.get(r.sessionId) ?? 0, r.at));
  if (r.project !== null || !st.projects.has(r.sessionId)) st.projects.set(r.sessionId, r.project);
  if (r.kind === 'wait') st.openWaits.set(r.sessionId, r);
  else if (r.kind === 'unblock') st.openWaits.delete(r.sessionId);
  else if (r.kind === 'session-open') st.sessionOpen.set(r.sessionId, true);
  else if (r.kind === 'session-close') st.sessionOpen.set(r.sessionId, false);
}

const isRecord = (v: unknown): v is HistoryRecord => {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.k === 'string' && typeof r.at === 'number' && typeof r.sessionId === 'string' && KINDS.has(r.kind as HistoryEventKind);
};

/** Legge un file del giorno; righe illeggibili (es. troncate da un arresto) scartate. */
async function loadDay(dir: string, day: string): Promise<DayState> {
  const st = emptyDay(day);
  let text: string;
  try {
    text = await readFile(join(dir, `${day}.jsonl`), 'utf8');
  } catch {
    return st;
  }
  for (const line of text.split('\n')) {
    if (!line || st.records.length >= MAX_RECORDS) continue;
    try {
      const r: unknown = JSON.parse(line);
      if (isRecord(r)) apply(st, { ...r, project: typeof r.project === 'string' ? r.project : null });
    } catch {
      // riga troncata
    }
  }
  return st;
}

/** Solo i campi della cronologia, nell'ordine del tipo. */
function toEvent(r: HistoryRecord): HistoryEvent {
  const e: HistoryEvent = { at: r.at, kind: r.kind, sessionId: r.sessionId, project: r.project };
  if (r.agent !== undefined) e.agent = r.agent;
  if (r.agentType !== undefined) e.agentType = r.agentType;
  if (r.tool !== undefined) e.tool = r.tool;
  if (r.waitingKind !== undefined) e.waitingKind = r.waitingKind;
  if (r.durationMs !== undefined) e.durationMs = r.durationMs;
  return e;
}

/** Riepilogo di un giorno (puro); con `now` aggiunge le attese in corso fino a `now` e i file delle sessioni aperte. */
function summarize(st: DayState, days: string[], now: number | null, liveFiles: (sessionId: string) => string[]): HistoryReport {
  // a parità di chiave conta l'ultima riga (agente ripreso e terminato di nuovo)
  const latest = st.records.filter((r) => st.byKey.get(r.k) === r);

  const waits = new Map<string, WaitStats>();
  const wait = (r: HistoryRecord) => {
    let w = waits.get(r.sessionId);
    if (!w) waits.set(r.sessionId, (w = { sessionId: r.sessionId, project: st.projects.get(r.sessionId) ?? r.project, count: 0, totalMs: 0 }));
    return w;
  };
  const types = new Map<string, { count: number; ms: number; cost: number; costed: number }>();
  /** file per agente (ultima fine) e per sessione (ultima chiusura, o adesso se aperta) */
  const touched = new Map<string, string[]>();
  for (const r of latest) {
    if (r.kind === 'wait') wait(r).count++;
    else if (r.kind === 'unblock') wait(r).totalMs += r.durationMs ?? 0;
    else if (r.kind === 'agent-end') {
      const t = types.get(r.agentType ?? '') ?? { count: 0, ms: 0, cost: 0, costed: 0 };
      t.count++;
      t.ms += r.durationMs ?? 0;
      if (typeof r.cost === 'number') {
        t.cost += r.cost;
        t.costed++;
      }
      types.set(r.agentType ?? '', t);
      if (r.files) touched.set(`a:${r.agentId ?? r.k}`, r.files);
    } else if (r.kind === 'session-close' && r.files) touched.set(`s:${r.sessionId}`, r.files);
  }
  if (now !== null) {
    for (const w of st.openWaits.values()) wait(w).totalMs += Math.max(0, now - w.at);
    for (const [id, open] of st.sessionOpen) if (open) touched.set(`s:${id}`, liveFiles(id));
  }

  const counts = new Map<string, number>();
  for (const names of touched.values()) for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  const sessions = [...waits.values()].sort((a, b) => b.totalMs - a.totalMs || b.count - a.count);
  return {
    day: st.day,
    days,
    events: latest.sort((a, b) => b.at - a.at).slice(0, MAX_EVENTS).map(toEvent),
    waits: {
      count: sessions.reduce((n, w) => n + w.count, 0),
      totalMs: sessions.reduce((n, w) => n + w.totalMs, 0),
      sessions,
    },
    byType: [...types]
      .map(([agentType, t]): AgentTypeStats => ({
        agentType,
        count: t.count,
        avgMs: Math.round(t.ms / t.count),
        cost: t.costed > 0 ? t.cost : null,
        avgCost: t.costed > 0 ? t.cost / t.costed : null,
      }))
      .sort((a, b) => b.count - a.count || a.agentType.localeCompare(b.agentType)),
    files: [...counts]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, MAX_FILES),
  };
}

export function createHistory(opts: HistoryOptions): History {
  const now = opts.now ?? Date.now;
  const keepDays = opts.keepDays ?? KEEP_DAYS;
  const filesOf = opts.filesOf ?? (() => []);
  let st = emptyDay(dayOf(now()));
  /** prima osservazione dopo l'avvio: le attese chiuse mentre il server era spento finiscono all'ultima attività */
  let first = true;
  let writing: Promise<void> = Promise.resolve();
  let closedCache: { version: number; active: string; value: FinishedAgent[] | undefined } | null = null;
  /** cresce a ogni riga registrata: invalida la cache dei terminati */
  let version = 0;

  const enqueue = (task: () => Promise<unknown>) => {
    writing = writing.then(task).then(
      () => {},
      () => {}, // disco pieno o cartella rimossa: lo storico è una comodità, il server continua
    );
  };

  /** cancella i file dei giorni oltre keepDays */
  const prune = () =>
    enqueue(async () => {
      const oldest = dayOf(now() - keepDays * 86_400_000);
      for (const name of await readdir(opts.dir)) {
        const day = FILE_RE.exec(name)?.[1];
        if (day && day < oldest) await rm(join(opts.dir, name), { force: true });
      }
    });

  const days = async (): Promise<string[]> => {
    await writing;
    try {
      return (await readdir(opts.dir)).flatMap((n) => FILE_RE.exec(n)?.[1] ?? []).sort().reverse();
    } catch {
      return [];
    }
  };

  const files = (sessionId: string, agentId: string | null) => filesOf(sessionId, agentId).slice(0, MAX_FILES_PER_RECORD);

  return {
    async start() {
      await mkdir(opts.dir, { recursive: true });
      prune();
      await writing;
      st = await loadDay(opts.dir, dayOf(now()));
      first = true;
    },

    observe(snapshot) {
      const t = now();
      const today = dayOf(t);
      if (today !== st.day) {
        // mezzanotte: giornata nuova; le sessioni aperte e le attese in corso continuano senza un nuovo evento
        const carried = st;
        st = emptyDay(today);
        for (const [id, open] of carried.sessionOpen) if (open) st.sessionOpen.set(id, true);
        for (const [id, w] of carried.openWaits) st.openWaits.set(id, w);
        prune();
      }
      const midnight = midnightOf(t);
      const lines: string[] = [];
      const add = (r: HistoryRecord) => {
        if (st.records.length >= MAX_RECORDS) return;
        apply(st, r);
        lines.push(JSON.stringify(r));
      };
      const has = (k: string) => st.byKey.has(k);

      const sessions = new Map(snapshot.sessions.map((s) => [s.id, s]));
      const agentsById = new Map<string, AgentState>();
      for (const a of [...snapshot.agents, ...(snapshot.finished ?? [])]) agentsById.set(a.id, a);
      const projectFor = (sessionId: string) => {
        const s = sessions.get(sessionId);
        return s ? (s.project ?? projectOf(s.cwd)) : (st.projects.get(sessionId) ?? null);
      };

      for (const s of snapshot.sessions) {
        const project = s.project ?? projectOf(s.cwd);
        const base = { sessionId: s.id, project };
        // apertura: la prima volta che la si vede oggi (se è nata oggi), o quando torna attiva dopo una chiusura
        const open = st.sessionOpen.get(s.id);
        if (s.active && !open) {
          if (open === false) add({ ...base, k: `o:${s.id}:${s.updatedAt}`, at: s.updatedAt, kind: 'session-open' });
          else if (s.startedAt >= midnight && !has(`o:${s.id}:${s.startedAt}`)) add({ ...base, k: `o:${s.id}:${s.startedAt}`, at: s.startedAt, kind: 'session-open' });
          else st.sessionOpen.set(s.id, true);
        }
        if (s.active) st.lastAt.set(s.id, Math.max(st.lastAt.get(s.id) ?? 0, s.updatedAt));

        // attese: una per inizio (waitingSince), chiusa quando la sessione non aspetta più
        const w = st.openWaits.get(s.id);
        if (s.active && s.waiting) {
          const since = s.waitingSince ?? w?.at ?? t;
          if (w && w.at !== since) add({ ...base, k: `u:${s.id}:${w.at}`, at: since, kind: 'unblock', durationMs: Math.max(0, since - w.at), ...(w.waitingKind ? { waitingKind: w.waitingKind } : {}) });
          if (!w || w.at !== since) {
            const agent = s.waitingAgentId ? agentsById.get(s.waitingAgentId) : undefined;
            const tool = (agent ?? s).tool?.name;
            add({
              ...base,
              k: `w:${s.id}:${since}`,
              at: since,
              kind: 'wait',
              ...(s.waitingAgentId ? { agent: nicknameOf(s.waitingAgentId) } : {}),
              ...(agent ? { agentType: agent.agentType } : {}),
              ...(tool ? { tool } : {}),
              ...(s.waitingKind ? { waitingKind: s.waitingKind } : {}),
            });
          }
        } else if (w) {
          const end = first ? Math.max(w.at, Math.min(t, s.updatedAt)) : t;
          add({ ...base, k: `u:${s.id}:${w.at}`, at: end, kind: 'unblock', durationMs: end - w.at, ...(w.waitingKind ? { waitingKind: w.waitingKind } : {}) });
        }

        const c = s.lastCompaction;
        if (c && c.at >= midnight && !has(`c:${s.id}:${c.at}`)) add({ ...base, k: `c:${s.id}:${c.at}`, at: c.at, kind: 'compact' });
      }

      // chiusura: le sessioni aperte che non sono più attive (o sono sparite dallo snapshot)
      for (const [id, open] of [...st.sessionOpen]) {
        if (!open || sessions.get(id)?.active) continue;
        const base = { sessionId: id, project: projectFor(id) };
        const w = st.openWaits.get(id);
        if (w) add({ ...base, k: `u:${id}:${w.at}`, at: Math.max(w.at, st.lastAt.get(id) ?? w.at), kind: 'unblock', durationMs: Math.max(0, (st.lastAt.get(id) ?? w.at) - w.at) });
        const at = Math.max(st.lastAt.get(id) ?? t, midnight);
        add({ ...base, k: `x:${id}:${at}`, at, kind: 'session-close', files: files(id, null) });
      }

      for (const a of agentsById.values()) {
        const base = { sessionId: a.sessionId, project: projectFor(a.sessionId), agent: a.nickname ?? nicknameOf(a.id), agentType: a.agentType };
        if (a.startedAt >= midnight && !has(`s:${a.id}`)) add({ ...base, k: `s:${a.id}`, at: a.startedAt, kind: 'agent-start' });
        if (a.status !== 'done' || a.updatedAt < midnight) continue;
        const prev = st.byKey.get(`e:${a.id}`);
        if (prev && a.updatedAt <= prev.at + RESUMED_MS) continue;
        add({
          ...base,
          k: `e:${a.id}`,
          at: a.updatedAt,
          kind: 'agent-end',
          durationMs: Math.max(0, a.updatedAt - a.startedAt),
          agentId: a.id,
          startedAt: a.startedAt,
          area: a.area,
          outputTokens: a.tokens.output,
          cost: a.cost ?? null,
          files: files(a.sessionId, a.id),
        });
      }

      first = false;
      if (lines.length === 0) return;
      version++;
      const file = join(opts.dir, `${st.day}.jsonl`);
      const text = lines.map((l) => `${l}\n`).join('');
      enqueue(() => appendFile(file, text));
    },

    closedFinished() {
      const active = [...st.sessionOpen].filter(([, open]) => open).map(([id]) => id).sort().join(',');
      if (closedCache?.version === version && closedCache.active === active) return closedCache.value;
      const open = new Set(active.split(','));
      const list = [...st.byKey.values()]
        .filter((r) => r.kind === 'agent-end' && !open.has(r.sessionId))
        .sort((a, b) => b.at - a.at)
        .slice(0, MAX_CLOSED_FINISHED)
        .map((r): FinishedAgent => ({
          id: r.agentId ?? r.k.slice(2),
          sessionId: r.sessionId,
          project: r.project,
          nickname: r.agent ?? nicknameOf(r.agentId ?? r.k.slice(2)),
          agentType: r.agentType ?? '',
          area: r.area ?? 'other',
          startedAt: r.startedAt ?? r.at,
          endedAt: r.at,
          outputTokens: r.outputTokens ?? 0,
          cost: r.cost ?? null,
        }));
      const value = list.length > 0 ? list : undefined;
      closedCache = { version, active, value };
      return value;
    },

    async report(day) {
      const t = now();
      const wanted = day ?? dayOf(t);
      if (!DAY_RE.test(wanted)) return null;
      // oggi c'è sempre, anche prima del primo evento
      const all = [...new Set([st.day, ...(await days())])].sort().reverse();
      if (wanted === st.day) return summarize(st, all, t, (id) => files(id, null));
      return summarize(await loadDay(opts.dir, wanted), all, null, () => []);
    },

    flush: () => writing,
  };
}
