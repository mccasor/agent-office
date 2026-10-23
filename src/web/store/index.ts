import { useCallback } from 'react';
import { create } from 'zustand';
import { setLocale, type Locale } from '../../shared/i18n';
import { DEFAULT_DISPLAY, isShown, toDisplaySettings, type DisplaySettings, type SettingKey } from '../../shared/settings';
import type { AgentState, Snapshot } from '../../shared/types';

/** pixel = ufficio (2D in pixel art), list = lista delle sessioni, history = analisi della giornata (#98) */
export type OfficeView = 'pixel' | 'list' | 'history';

/**
 * Vista richiesta (preferenza salvata, ?view=, app della menu bar) -> vista valida; null se sconosciuta.
 * 'office' era la vista 3D, rimossa: preferenze salvate e app della menu bar già installate aprono l'ufficio 2D.
 */
export function toView(v: unknown): OfficeView | null {
  if (v === 'office' || v === 'pixel') return 'pixel';
  return v === 'list' || v === 'history' ? v : null;
}

export interface OfficeStoreState {
  snapshot: Snapshot | null;
  connected: boolean;
  /** vista mostrata: ufficio o lista delle sessioni */
  view: OfficeView;
  /** sessioni escluse dall'ufficio (scelta nella vista lista); le nuove sono visibili */
  hiddenSessions: string[];
  /** sessione da evidenziare (aperta dal pannello della menu bar); null = nessuna */
  focusSession: string | null;
  /** agente (o `boss:<sessionId>`) di cui è aperta la scheda; null = nessuna. Non salvato tra le visite */
  selectedAgent: string | null;
  /** preferenze di visualizzazione da config.json (#94), dal server; i default finché non arrivano */
  settings: DisplaySettings;
  /** subagenti fatti uscire a mano ("Fallo uscire", #97) e quando: nascosti finché non hanno attività più recente */
  dismissed: Record<string, number>;
  setSnapshot(snapshot: Snapshot): void;
  setSettings(settings: DisplaySettings): void;
  /** mostra la vista e, se indicata, evidenzia la sessione */
  focus(view: OfficeView, sessionId: string | null): void;
  setConnected(connected: boolean): void;
  setView(view: OfficeView): void;
  toggleSession(sessionId: string): void;
  select(agentId: string | null): void;
  /** fa uscire un subagente fermo: sparisce da ufficio e lista finché non torna attivo */
  dismiss(agentId: string): void;
  /** fa rientrare a mano i subagenti fatti uscire (#101) */
  restore(agentIds: readonly string[]): void;
}

const PREFS_KEY = 'agent-office.prefs';

/** Preferenze del visitatore (vista, sessioni nascoste): comodità locale, la pagina funziona anche senza. */
function loadPrefs(): Pick<OfficeStoreState, 'view' | 'hiddenSessions'> {
  // ?view=pixel|list (es. dal menu dell'app nella menu bar) prevale sulla preferenza salvata, anche se illeggibile
  const asked = toView(new URLSearchParams(globalThis.location?.search ?? '').get('view'));
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(PREFS_KEY) ?? '{}');
    const p = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const hidden = Array.isArray(p.hiddenSessions) ? p.hiddenSessions.filter((x): x is string => typeof x === 'string') : [];
    return { view: asked ?? toView(p.view) ?? 'pixel', hiddenSessions: hidden };
  } catch {
    return { view: asked ?? 'pixel', hiddenSessions: [] };
  }
}

function savePrefs(prefs: Pick<OfficeStoreState, 'view' | 'hiddenSessions'>): void {
  try {
    globalThis.localStorage?.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // storage non disponibile (finestra privata, dati bloccati): si resta sui valori in memoria
  }
}

const DISMISSED_KEY = 'agent-office.dismissed';

/**
 * Subagenti fatti uscire, salvati nel browser come le sessioni nascoste: è una scelta di chi guarda, non uno stato
 * dell'agente, e il server resta in sola lettura. Senza storage valgono solo per questa pagina.
 */
function loadDismissed(): Record<string, number> {
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(DISMISSED_KEY) ?? '{}');
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter((e): e is [string, number] => typeof e[1] === 'number'));
  } catch {
    return {};
  }
}

function saveDismissed(dismissed: Record<string, number>): void {
  try {
    globalThis.localStorage?.setItem(DISMISSED_KEY, JSON.stringify(dismissed));
  } catch {
    // storage non disponibile: si resta sui valori in memoria
  }
}

/**
 * Segue i subagenti fatti uscire nelle altre finestre (#101): ufficio e schede staccate hanno ognuna il suo store ma
 * la stessa origine, quindi lo stesso localStorage, e l'evento `storage` arriva alle altre finestre a ogni scrittura.
 * Al ritorno in primo piano si rilegge comunque, nel caso una finestra nascosta l'abbia perso. Ritorna la funzione di chiusura.
 */
export function watchDismissed(): () => void {
  const reload = () => useOfficeStore.setState({ dismissed: loadDismissed() });
  const onStorage = (e: StorageEvent) => {
    // key null: storage svuotato
    if (e.key === DISMISSED_KEY || e.key === null) reload();
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') reload();
  };
  window.addEventListener('storage', onStorage);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.removeEventListener('storage', onStorage);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/** Fatto uscire e da allora senza attività: resta fuori. Torna attivo (updatedAt più recente): rientra. */
export const isDismissed = (a: Pick<AgentState, 'id' | 'updatedAt'>, dismissed: Readonly<Record<string, number>>): boolean =>
  Object.hasOwn(dismissed, a.id) && a.updatedAt <= dismissed[a.id]!;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const idOf = (v: unknown): unknown => (isObject(v) ? v.id : undefined);

/**
 * Condivisione strutturale: `next` con le parti uguali a `prev` sostituite dagli oggetti di `prev`. Ogni snapshot
 * arriva come JSON nuovo; così sessioni e agenti che non sono cambiati restano gli stessi oggetti e le viste
 * (React.memo) saltano le righe ferme. Negli array gli elementi con `id` si abbinano per id, gli altri per posizione.
 * Pura; restituisce `prev` se tutto è uguale.
 */
export function share<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next) || !isObject(prev) || !isObject(next)) return next;
  if (Array.isArray(next) !== Array.isArray(prev)) return next;
  if (Array.isArray(next)) {
    const old = prev as unknown as unknown[];
    const byId = new Map(old.filter((v) => idOf(v) !== undefined).map((v) => [idOf(v), v]));
    let same = old.length === next.length;
    const out = next.map((v: unknown, i) => {
      const was = idOf(v) !== undefined ? byId.get(idOf(v)) : old[i];
      const kept = share(was, v);
      if (kept !== old[i]) same = false;
      return kept;
    });
    return (same ? prev : out) as T;
  }
  const keys = Object.keys(next);
  let same = keys.length === Object.keys(prev).length;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    out[k] = share(prev[k], next[k]);
    if (out[k] !== prev[k] || !Object.hasOwn(prev, k)) same = false;
  }
  return (same ? prev : out) as T;
}

/** hook zustand */
export const useOfficeStore = create<OfficeStoreState>()((set, get) => ({
  snapshot: null,
  connected: false,
  ...loadPrefs(),
  // ?session=<id> (dal pannello della menu bar alla prima apertura)
  focusSession: new URLSearchParams(globalThis.location?.search ?? '').get('session') || null,
  selectedAgent: null,
  settings: DEFAULT_DISPLAY,
  dismissed: loadDismissed(),
  setSnapshot: (snapshot) => set({ snapshot: share(get().snapshot, snapshot) }),
  // stessi oggetti se nulla cambia: i componenti che leggono una voce non si ridisegnano. La lingua (#93) va impostata
  // prima di avvisare i componenti: i testi (src/shared/i18n) la leggono mentre si ridisegnano
  setSettings: (settings) => {
    setLocale(settings.locale);
    if (typeof document !== 'undefined') document.documentElement.lang = settings.locale;
    set({ settings: share(get().settings, settings) });
  },
  setConnected: (connected) => set({ connected }),
  focus: (view, sessionId) => {
    set({ view, focusSession: sessionId || null });
    savePrefs({ view, hiddenSessions: get().hiddenSessions });
  },
  setView: (view) => {
    set({ view });
    savePrefs({ view, hiddenSessions: get().hiddenSessions });
  },
  toggleSession: (sessionId) => {
    const hidden = get().hiddenSessions;
    // si tengono solo gli id ancora presenti, così la lista non cresce all'infinito
    const live = new Set(get().snapshot?.sessions.map((s) => s.id) ?? []);
    const next = hidden.includes(sessionId)
      ? hidden.filter((id) => id !== sessionId)
      : [...hidden.filter((id) => live.has(id)), sessionId];
    set({ hiddenSessions: next });
    savePrefs({ view: get().view, hiddenSessions: next });
  },
  select: (agentId) => set({ selectedAgent: agentId }),
  dismiss: (agentId) => {
    // si tengono solo gli agenti ancora nello snapshot, così l'elenco non cresce all'infinito
    const live = new Set([...(get().snapshot?.agents ?? []), ...(get().snapshot?.finished ?? [])].map((a) => a.id));
    const kept = Object.entries(get().dismissed).filter(([id]) => live.has(id));
    const next = { ...Object.fromEntries(kept), [agentId]: Date.now() };
    set({ dismissed: next, selectedAgent: get().selectedAgent === agentId ? null : get().selectedAgent });
    saveDismissed(next);
  },
  restore: (agentIds) => {
    const next = Object.fromEntries(Object.entries(get().dismissed).filter(([id]) => !agentIds.includes(id)));
    set({ dismissed: next });
    saveDismissed(next);
  },
}));

/** Preferenze di visualizzazione correnti. */
export const useSettings = (): DisplaySettings => useOfficeStore((s) => s.settings);

/**
 * Lingua corrente (#93): chi la legge si ridisegna quando cambia, e con lui i figli. La usano le radici (App,
 * CardWindow); i componenti memo che leggono le voci (useShown) cambiano già con le preferenze.
 */
export const useLocale = (): Locale => useOfficeStore((s) => s.settings.locale);

/** La voce `key` del catalogo (shared/settings.ts) è da mostrare: `{useShow('session.diff') && <DiffStat …/>}`. */
export const useShow = (key: SettingKey): boolean => useOfficeStore((s) => isShown(s.settings, key));

/** Tutte le voci in una volta, per chi ne legge molte: `const show = useShown(); show('agent.role')`. */
export function useShown(): (key: SettingKey) => boolean {
  const settings = useSettings();
  return useCallback((key: SettingKey) => isShown(settings, key), [settings]);
}

/**
 * Snapshot ristretto alle sessioni visibili nell'ufficio (e ai loro agenti), senza i subagenti fatti uscire. I
 * terminati già usciti (`finished`) restano anche se fatti uscire: sono il resoconto della giornata, non l'ufficio. Pura.
 */
export function visibleSnapshot(
  snapshot: Snapshot | null,
  hidden: readonly string[],
  dismissed: Readonly<Record<string, number>> = {},
): Snapshot | null {
  if (!snapshot || (hidden.length === 0 && Object.keys(dismissed).length === 0)) return snapshot;
  const h = new Set(hidden);
  return {
    ...snapshot,
    sessions: snapshot.sessions.filter((s) => !h.has(s.id)),
    agents: snapshot.agents.filter((a) => !h.has(a.sessionId) && !isDismissed(a, dismissed)),
    finished: snapshot.finished?.filter((a) => !h.has(a.sessionId)),
  };
}

const SNAPSHOT_URL = '/api/snapshot';
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 15_000;

/**
 * Apre l'EventSource su /api/events (con riconnessione) e aggiorna lo store. Ritorna la funzione di chiusura.
 *
 * - evento SSE `snapshot` (JSON) → setSnapshot; JSON malformato ignorato
 * - evento SSE `config` (preferenze di visualizzazione, alla connessione e quando cambiano) → setSettings
 * - onopen → connected=true e backoff azzerato; onerror → connected=false, chiusura e
 *   riconnessione dopo 1s, 2s, 4s, … fino a 15s
 * - fetch iniziale di /api/snapshot come fallback: applicato solo se lo stream non ha ancora
 *   consegnato uno snapshot (evita di sovrascrivere dati più recenti)
 */
export function connectSnapshotStream(url = '/api/events'): () => void {
  const { setSnapshot, setConnected, setSettings } = useOfficeStore.getState();
  const abort = new AbortController();
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let delay = BACKOFF_MIN_MS;
  let disposed = false;
  let streamDelivered = false;

  const apply = (raw: string, fromStream: boolean) => {
    if (disposed) return;
    let parsed: Snapshot;
    try {
      parsed = JSON.parse(raw) as Snapshot;
    } catch {
      return;
    }
    if (fromStream) streamDelivered = true;
    else if (streamDelivered) return;
    setSnapshot(parsed);
  };

  const open = () => {
    timer = null;
    if (disposed) return;
    const es = new EventSource(url);
    source = es;
    es.addEventListener('snapshot', (ev) => apply((ev as MessageEvent<string>).data, true));
    es.addEventListener('config', (ev) => {
      if (disposed) return;
      try {
        setSettings(toDisplaySettings(JSON.parse((ev as MessageEvent<string>).data)));
      } catch {
        // JSON malformato: restano le preferenze di prima
      }
    });
    es.onopen = () => {
      if (disposed || source !== es) return;
      delay = BACKOFF_MIN_MS;
      setConnected(true);
    };
    es.onerror = () => {
      if (disposed || source !== es) return;
      es.close();
      source = null;
      setConnected(false);
      timer = setTimeout(open, delay);
      delay = Math.min(delay * 2, BACKOFF_MAX_MS);
    };
  };

  open();

  fetch(SNAPSHOT_URL, { signal: abort.signal })
    .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((text) => apply(text, false))
    .catch(() => {
      /* fallback best-effort: lo stream SSE resta la fonte primaria */
    });

  return () => {
    if (disposed) return;
    disposed = true;
    abort.abort();
    if (timer !== null) clearTimeout(timer);
    timer = null;
    source?.close();
    source = null;
    setConnected(false);
  };
}
