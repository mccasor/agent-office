import { create } from 'zustand';
import type { Snapshot } from '../../shared/types';

export type OfficeView = 'office' | 'list';

export interface OfficeStoreState {
  snapshot: Snapshot | null;
  connected: boolean;
  /** vista mostrata: ufficio 3D o lista delle sessioni */
  view: OfficeView;
  /** sessioni escluse dall'ufficio (scelta nella vista lista); le nuove sono visibili */
  hiddenSessions: string[];
  setSnapshot(snapshot: Snapshot): void;
  setConnected(connected: boolean): void;
  setView(view: OfficeView): void;
  toggleSession(sessionId: string): void;
}

const PREFS_KEY = 'agent-office.prefs';

/** Preferenze del visitatore (vista, sessioni nascoste): comodità locale, la pagina funziona anche senza. */
function loadPrefs(): Pick<OfficeStoreState, 'view' | 'hiddenSessions'> {
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(PREFS_KEY) ?? '{}');
    const p = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const hidden = Array.isArray(p.hiddenSessions) ? p.hiddenSessions.filter((x): x is string => typeof x === 'string') : [];
    // ?view=list|office (es. dal menu dell'app nella menu bar) prevale sulla preferenza salvata
    const asked = new URLSearchParams(globalThis.location?.search ?? '').get('view');
    const view = asked === 'list' || asked === 'office' ? asked : p.view === 'list' ? 'list' : 'office';
    return { view, hiddenSessions: hidden };
  } catch {
    return { view: 'office', hiddenSessions: [] };
  }
}

function savePrefs(prefs: Pick<OfficeStoreState, 'view' | 'hiddenSessions'>): void {
  try {
    globalThis.localStorage?.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // storage non disponibile (finestra privata, dati bloccati): si resta sui valori in memoria
  }
}

/** hook zustand */
export const useOfficeStore = create<OfficeStoreState>()((set, get) => ({
  snapshot: null,
  connected: false,
  ...loadPrefs(),
  setSnapshot: (snapshot) => set({ snapshot }),
  setConnected: (connected) => set({ connected }),
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
}));

/** Snapshot ristretto alle sessioni visibili nell'ufficio (e ai loro agenti). Pura. */
export function visibleSnapshot(snapshot: Snapshot | null, hidden: readonly string[]): Snapshot | null {
  if (!snapshot || hidden.length === 0) return snapshot;
  const h = new Set(hidden);
  return {
    ...snapshot,
    sessions: snapshot.sessions.filter((s) => !h.has(s.id)),
    agents: snapshot.agents.filter((a) => !h.has(a.sessionId)),
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
 * - onopen → connected=true e backoff azzerato; onerror → connected=false, chiusura e
 *   riconnessione dopo 1s, 2s, 4s, … fino a 15s
 * - fetch iniziale di /api/snapshot come fallback: applicato solo se lo stream non ha ancora
 *   consegnato uno snapshot (evita di sovrascrivere dati più recenti)
 */
export function connectSnapshotStream(url = '/api/events'): () => void {
  const { setSnapshot, setConnected } = useOfficeStore.getState();
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
