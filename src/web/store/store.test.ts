import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '../../shared/types';
import { connectSnapshotStream, useOfficeStore, visibleSnapshot } from './index';

type Listener = (ev: MessageEvent) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  listeners = new Map<string, Listener[]>();
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l !== fn));
  }
  close() {
    this.closed = true;
  }
  // helper di test
  open() {
    this.onopen?.(new Event('open'));
  }
  fail() {
    this.onerror?.(new Event('error'));
  }
  emit(type: string, data: string) {
    for (const l of this.listeners.get(type) ?? []) l({ data } as MessageEvent);
  }
}

const snap = (generatedAt: number): Snapshot => ({ status: 'idle', repo: null, sessions: [], agents: [], generatedAt });
const last = () => FakeEventSource.instances.at(-1)!;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  fetchMock = vi.fn(() => new Promise<Response>(() => {})); // pending di default
  vi.stubGlobal('fetch', fetchMock);
  useOfficeStore.setState({ snapshot: null, connected: false });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useOfficeStore', () => {
  it('stato iniziale e setter', () => {
    expect(useOfficeStore.getState().snapshot).toBeNull();
    expect(useOfficeStore.getState().connected).toBe(false);
    useOfficeStore.getState().setSnapshot(snap(1));
    useOfficeStore.getState().setConnected(true);
    expect(useOfficeStore.getState().snapshot?.generatedAt).toBe(1);
    expect(useOfficeStore.getState().connected).toBe(true);
  });
});

describe('connectSnapshotStream', () => {
  it('apre EventSource su /api/events di default e aggiorna snapshot', () => {
    const stop = connectSnapshotStream();
    expect(last().url).toBe('/api/events');
    last().open();
    expect(useOfficeStore.getState().connected).toBe(true);
    last().emit('snapshot', JSON.stringify(snap(42)));
    expect(useOfficeStore.getState().snapshot?.generatedAt).toBe(42);
    stop();
  });

  it('usa url personalizzato e ignora JSON malformato', () => {
    const stop = connectSnapshotStream('/x/events');
    expect(last().url).toBe('/x/events');
    expect(() => last().emit('snapshot', '{nope')).not.toThrow();
    expect(useOfficeStore.getState().snapshot).toBeNull();
    stop();
  });

  it('fetch iniziale di /api/snapshot come fallback', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(snap(7)), { status: 200 }));
    const stop = connectSnapshotStream();
    expect(fetchMock).toHaveBeenCalledWith('/api/snapshot', expect.anything());
    await vi.runAllTimersAsync();
    expect(useOfficeStore.getState().snapshot?.generatedAt).toBe(7);
    stop();
  });

  it('il fallback non sovrascrive uno snapshot già arrivato via SSE', async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
    const stop = connectSnapshotStream();
    last().emit('snapshot', JSON.stringify(snap(100)));
    resolve(new Response(JSON.stringify(snap(1)), { status: 200 }));
    await vi.runAllTimersAsync();
    expect(useOfficeStore.getState().snapshot?.generatedAt).toBe(100);
    stop();
  });

  it('fallback fallito (rete o HTTP non ok) non lancia', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const stop = connectSnapshotStream();
    await vi.runAllTimersAsync();
    stop();
    fetchMock.mockResolvedValueOnce(new Response('x', { status: 500 }));
    const stop2 = connectSnapshotStream();
    await vi.runAllTimersAsync();
    expect(useOfficeStore.getState().snapshot).toBeNull();
    stop2();
  });

  it('onerror: connected false, chiude e riconnette con backoff 1s→2s→4s… max 15s', () => {
    const stop = connectSnapshotStream();
    last().open();
    expect(useOfficeStore.getState().connected).toBe(true);
    const delays = [1000, 2000, 4000, 8000, 15000, 15000];
    for (const d of delays) {
      const es = last();
      es.fail();
      expect(es.closed).toBe(true);
      expect(useOfficeStore.getState().connected).toBe(false);
      const n = FakeEventSource.instances.length;
      vi.advanceTimersByTime(d - 1);
      expect(FakeEventSource.instances.length).toBe(n);
      vi.advanceTimersByTime(1);
      expect(FakeEventSource.instances.length).toBe(n + 1);
    }
    stop();
  });

  it('il backoff si resetta a 1s dopo una connessione riuscita', () => {
    const stop = connectSnapshotStream();
    last().fail();
    vi.advanceTimersByTime(1000);
    last().fail();
    vi.advanceTimersByTime(2000);
    last().open(); // successo → reset
    last().fail();
    const n = FakeEventSource.instances.length;
    vi.advanceTimersByTime(1000);
    expect(FakeEventSource.instances.length).toBe(n + 1);
    stop();
  });

  it('errori ripetuti sulla stessa sorgente non programmano più riconnessioni', () => {
    const stop = connectSnapshotStream();
    last().fail();
    last().fail();
    vi.advanceTimersByTime(1000);
    expect(FakeEventSource.instances.length).toBe(2);
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.instances.length).toBe(2);
    stop();
  });

  it('cleanup chiude la sorgente, cancella il timer e ignora eventi successivi', () => {
    const stop = connectSnapshotStream();
    const es = last();
    es.fail();
    stop();
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.instances.length).toBe(1);
    expect(es.closed).toBe(true);

    const stop2 = connectSnapshotStream();
    const es2 = last();
    stop2();
    expect(es2.closed).toBe(true);
    es2.open();
    es2.emit('snapshot', JSON.stringify(snap(9)));
    expect(useOfficeStore.getState().snapshot).toBeNull();
    expect(useOfficeStore.getState().connected).toBe(false);
  });
});

describe('sessioni visibili nell\'ufficio', () => {
  it('visibleSnapshot toglie le sessioni nascoste e i loro agenti', () => {
    const s = (id: string) => ({ id }) as Snapshot['sessions'][number];
    const a = (id: string, sessionId: string) => ({ id, sessionId }) as Snapshot['agents'][number];
    const snap = { status: 'idle', repo: null, sessions: [s('x'), s('y')], agents: [a('1', 'x'), a('2', 'y')], generatedAt: 0 } as Snapshot;
    expect(visibleSnapshot(snap, [])).toBe(snap);
    const v = visibleSnapshot(snap, ['y'])!;
    expect(v.sessions.map((x) => x.id)).toEqual(['x']);
    expect(v.agents.map((x) => x.id)).toEqual(['1']);
    expect(visibleSnapshot(null, ['y'])).toBeNull();
  });

  it('toggleSession e setView aggiornano lo store', () => {
    const st = useOfficeStore.getState();
    st.toggleSession('z');
    expect(useOfficeStore.getState().hiddenSessions).toEqual(['z']);
    useOfficeStore.getState().toggleSession('z');
    expect(useOfficeStore.getState().hiddenSessions).toEqual([]);
    useOfficeStore.getState().setView('list');
    expect(useOfficeStore.getState().view).toBe('list');
    useOfficeStore.getState().setView('office');
  });
});
