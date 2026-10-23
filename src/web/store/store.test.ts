import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DISPLAY, isShown } from '../../shared/settings';
import type { Snapshot } from '../../shared/types';
import { connectSnapshotStream, share, toView, useOfficeStore, visibleSnapshot } from './index';

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

const snap = (generatedAt: number): Snapshot => ({ status: 'idle', sessions: [], agents: [], generatedAt });
const last = () => FakeEventSource.instances.at(-1)!;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  fetchMock = vi.fn(() => new Promise<Response>(() => {})); // pending di default
  vi.stubGlobal('fetch', fetchMock);
  useOfficeStore.setState({ snapshot: null, connected: false, settings: DEFAULT_DISPLAY });
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

describe('condivisione strutturale degli snapshot', () => {
  it('le parti uguali restano gli stessi oggetti, quelle cambiate sono nuove', () => {
    const prev = { at: 1, list: [{ id: 'a', n: 1, tags: [1, 2] }, { id: 'b', n: 2, tags: [] }], meta: { x: null } };
    const next = share(prev, JSON.parse(JSON.stringify({ ...prev, at: 2, list: [prev.list[0], { ...prev.list[1], n: 3 }] })) as typeof prev);
    expect(next).not.toBe(prev);
    expect(next.at).toBe(2);
    expect(next.list[0]).toBe(prev.list[0]);
    expect(next.list[1]).not.toBe(prev.list[1]);
    expect(next.list[1]!.tags).toBe(prev.list[1]!.tags);
    expect(next.meta).toBe(prev.meta);
  });

  it('negli array abbina per id anche se l\'ordine cambia; tutto uguale: resta prev', () => {
    const prev = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }];
    const swapped = share(prev, [{ id: 'b', n: 2 }, { id: 'a', n: 1 }]);
    expect(swapped).not.toBe(prev);
    expect(swapped[0]).toBe(prev[1]);
    expect(swapped[1]).toBe(prev[0]);
    expect(share(prev, JSON.parse(JSON.stringify(prev)) as typeof prev)).toBe(prev);
  });

  it('chiavi aggiunte o tolte, tipi diversi: nuovo oggetto', () => {
    const prev: Record<string, unknown> = { a: 1, b: undefined };
    expect(share(prev, { a: 1 })).not.toBe(prev);
    expect(share({ a: 1 }, { a: 1, c: undefined })).toEqual({ a: 1, c: undefined });
    expect(share([1], { 0: 1 })).toEqual({ 0: 1 });
    expect(share(null, { a: 1 })).toEqual({ a: 1 });
  });

  it('lo store tiene gli agenti invariati tra due snapshot', () => {
    const first = snap(1);
    useOfficeStore.getState().setSnapshot(first);
    useOfficeStore.getState().setSnapshot(JSON.parse(JSON.stringify({ ...first, generatedAt: 2 })) as Snapshot);
    const { snapshot } = useOfficeStore.getState();
    expect(snapshot?.generatedAt).toBe(2);
    expect(snapshot?.sessions).toBe(first.sessions);
    expect(snapshot?.agents).toBe(first.agents);
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

  it('evento `config`: preferenze di visualizzazione nello store; JSON malformato ignorato (#94)', () => {
    const stop = connectSnapshotStream();
    expect(useOfficeStore.getState().settings).toEqual(DEFAULT_DISPLAY);
    last().emit('config', JSON.stringify({ language: 'en', show: { 'session.diff': false } }));
    const { settings } = useOfficeStore.getState();
    expect(settings.language).toBe('en');
    expect(isShown(settings, 'session.diff')).toBe(false);
    expect(isShown(settings, 'session.context')).toBe(true);
    last().emit('config', '{nope');
    expect(useOfficeStore.getState().settings).toBe(settings);
    // stesse preferenze: stesso oggetto, nessun nuovo rendering
    last().emit('config', JSON.stringify({ language: 'en', show: { 'session.diff': false } }));
    expect(useOfficeStore.getState().settings).toBe(settings);
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
    const snap = { status: 'idle', sessions: [s('x'), s('y')], agents: [a('1', 'x'), a('2', 'y')], generatedAt: 0 } as Snapshot;
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
    useOfficeStore.getState().setView('pixel');
  });

  it('nascondere una sessione toglie gli id delle sessioni sparite dallo snapshot', () => {
    const s = (id: string) => ({ id }) as Snapshot['sessions'][number];
    useOfficeStore.setState({
      snapshot: { status: 'idle', sessions: [s('a'), s('b')], agents: [], generatedAt: 0 },
      hiddenSessions: ['sparita', 'a'],
    });
    useOfficeStore.getState().toggleSession('b');
    expect(useOfficeStore.getState().hiddenSessions).toEqual(['a', 'b']);
    // mostrare di nuovo una sessione toglie solo quella
    useOfficeStore.setState({ hiddenSessions: ['sparita', 'a'] });
    useOfficeStore.getState().toggleSession('a');
    expect(useOfficeStore.getState().hiddenSessions).toEqual(['sparita']);
    useOfficeStore.setState({ snapshot: null, hiddenSessions: [] });
  });
});

describe('vista e scheda agente', () => {
  it('select apre e chiude la scheda', () => {
    useOfficeStore.getState().select('a1');
    expect(useOfficeStore.getState().selectedAgent).toBe('a1');
    useOfficeStore.getState().select(null);
    expect(useOfficeStore.getState().selectedAgent).toBeNull();
  });

  it('toView: la vecchia vista 3D (office) apre l\'ufficio 2D, valori sconosciuti -> null', () => {
    expect(toView('office')).toBe('pixel');
    expect(toView('pixel')).toBe('pixel');
    expect(toView('list')).toBe('list');
    expect(toView('boh')).toBeNull();
    expect(toView(null)).toBeNull();
  });

  /** store nuovo con le preferenze salvate `saved` e la query `search` */
  async function freshStore(saved: unknown, search = '', raw = JSON.stringify(saved)) {
    const data = new Map([['agent-office.prefs', raw]]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) });
    vi.stubGlobal('location', { search });
    vi.resetModules();
    const { useOfficeStore: store } = await import('./index');
    return { store, saved: () => JSON.parse(data.get('agent-office.prefs')!) as unknown };
  }

  it('preferenze: vista ricordata, valori sconosciuti → ufficio, 3D salvato o chiesto → ufficio 2D, ?view prevale', async () => {
    const { store, saved } = await freshStore({ view: 'pixel', hiddenSessions: ['x'] });
    expect(store.getState().view).toBe('pixel');
    expect(store.getState().hiddenSessions).toEqual(['x']);
    expect(store.getState().selectedAgent).toBeNull();
    store.getState().setView('list');
    expect(saved()).toEqual({ view: 'list', hiddenSessions: ['x'] });
    store.getState().select('a1');
    expect(saved()).toEqual({ view: 'list', hiddenSessions: ['x'] });
    expect((await freshStore({ view: 'list' })).store.getState().view).toBe('list');
    expect((await freshStore({ view: 'boh' })).store.getState().view).toBe('pixel');
    expect((await freshStore({ view: 'office' })).store.getState().view).toBe('pixel');
    expect((await freshStore({ view: 'list' }, '?view=office')).store.getState().view).toBe('pixel');
    expect((await freshStore({ view: 'list' }, '?view=pixel')).store.getState().view).toBe('pixel');
    expect((await freshStore({ view: 'pixel' }, '?view=nulla')).store.getState().view).toBe('pixel');
  });

  it('preferenze non valide: si ignorano i valori sbagliati e si tengono quelli validi', async () => {
    const hidden = async (saved: unknown) => (await freshStore(saved)).store.getState().hiddenSessions;
    expect(await hidden({ hiddenSessions: ['x', 3, null, 'y', { id: 'z' }] })).toEqual(['x', 'y']);
    expect(await hidden({ hiddenSessions: 'x' })).toEqual([]);
    expect(await hidden(null)).toEqual([]);
    expect(await hidden(['x'])).toEqual([]);
    const corrupt = (await freshStore(null, '', '{rotto')).store.getState();
    expect([corrupt.view, corrupt.hiddenSessions]).toEqual(['pixel', []]);
    // ?view prevale anche su preferenze illeggibili (l'app della menu bar apre la lista)
    expect((await freshStore(null, '?view=list', '{rotto')).store.getState().view).toBe('list');
  });

  it('storage non disponibile: default in lettura, nessun errore in scrittura', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    vi.stubGlobal('location', { search: '?session=s1' });
    vi.resetModules();
    const { useOfficeStore: store } = await import('./index');
    expect(store.getState()).toMatchObject({ view: 'pixel', hiddenSessions: [], focusSession: 's1' });
    expect(() => store.getState().toggleSession('s1')).not.toThrow();
    expect(store.getState().hiddenSessions).toEqual(['s1']);
  });
});
