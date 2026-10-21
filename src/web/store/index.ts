import { create } from 'zustand';
import type { Snapshot } from '../../shared/types';

export interface OfficeStoreState {
  snapshot: Snapshot | null;
  connected: boolean;
  setSnapshot(snapshot: Snapshot): void;
  setConnected(connected: boolean): void;
}

/** hook zustand */
export const useOfficeStore = create<OfficeStoreState>()((set) => ({
  snapshot: null,
  connected: false,
  setSnapshot: (snapshot) => set({ snapshot }),
  setConnected: (connected) => set({ connected }),
}));

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
