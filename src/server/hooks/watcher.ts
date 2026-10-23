import { mkdir, open, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { FSWatcher } from 'chokidar';
import type { HookEvent, Watcher } from '../../shared/types.js';
import { eventsFilePath, parseEventLine, type HookPathsOptions } from './events.js';

export const MAX_EVENTS = 2000;
/** all'avvio si leggono solo gli ultimi byte del file (la storia completa cresce senza limiti) */
export const INITIAL_TAIL_BYTES = 512 * 1024;
/** nell'unione di più file contano solo gli eventi recenti: servono per le sessioni attive */
export const MERGE_WINDOW_MS = 2 * 60 * 60_000;

export interface EventsTail {
  /** legge le righe aggiunte dall'ultima lettura; true se sono arrivati eventi nuovi */
  read(): Promise<boolean>;
  events(): HookEvent[];
  /** dimentica gli eventi precedenti a `since` */
  prune(since: number): void;
}

/**
 * Lettura incrementale (per offset) di un file eventi, senza watcher: chi la usa decide quando leggere.
 * Parte dagli ultimi INITIAL_TAIL_BYTES; se il file si accorcia (ruotato dall'hook) riparte da capo sul nuovo.
 * Letture serializzate: chiamate concorrenti si accodano.
 */
export async function createEventsTail(file: string): Promise<EventsTail> {
  let events: HookEvent[] = [];
  let offset = 0;
  let partial = '';
  /** si è partiti a metà file: la prima riga letta è incompleta */
  let skipFirstLine = false;
  let queue: Promise<boolean> = Promise.resolve(false);

  const size = await stat(file).then((st) => st.size, () => 0);
  if (size > INITIAL_TAIL_BYTES) {
    offset = size - INITIAL_TAIL_BYTES;
    skipFirstLine = true;
  }

  async function readNew(): Promise<boolean> {
    const { size } = await stat(file);
    if (size < offset) {
      // file ruotato dall'hook (o troncato): si legge il nuovo da capo, gli eventi già letti restano
      offset = 0;
      partial = '';
      skipFirstLine = false;
    }
    if (size === offset) return false;
    const fh = await open(file, 'r');
    let chunk: Buffer;
    try {
      chunk = Buffer.alloc(size - offset);
      const { bytesRead } = await fh.read(chunk, 0, chunk.length, offset);
      chunk = chunk.subarray(0, bytesRead);
    } finally {
      await fh.close();
    }
    offset += chunk.length;
    if (skipFirstLine) {
      const first = chunk.indexOf(0x0a);
      if (first === -1) return false;
      skipFirstLine = false;
      chunk = chunk.subarray(first + 1);
    }
    // le righe sono UTF-8: si spezza solo su '\n' (byte mai interno a sequenze multibyte)
    const nl = chunk.lastIndexOf(0x0a);
    if (nl === -1) {
      partial += chunk.toString('utf8');
      return false;
    }
    const text = partial + chunk.subarray(0, nl).toString('utf8');
    partial = chunk.subarray(nl + 1).toString('utf8');
    const fresh: HookEvent[] = [];
    for (const line of text.split('\n')) {
      const e = line.trim() ? parseEventLine(line) : null;
      if (e) fresh.push(e);
    }
    if (fresh.length === 0) return false;
    events = events.concat(fresh);
    if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);
    return true;
  }

  return {
    read() {
      queue = queue.then(readNew).catch(() => false);
      return queue;
    },
    events: () => events,
    prune(since) {
      const kept = events.filter((e) => e.timestamp >= since);
      if (kept.length < events.length) events = kept;
    },
  };
}

/** Eventi dell'hook di una cartella (o del file indicato), aggiornati a ogni modifica del file. */
export function createHookEventsWatcher(opts: ({ cwd: string } | { file: string }) & HookPathsOptions): Watcher<HookEvent[]> {
  const file = 'file' in opts ? opts.file : eventsFilePath(opts.cwd, opts);
  const listeners = new Set<(v: HookEvent[]) => void>();
  let tail: EventsTail | null = null;
  let fsw: FSWatcher | null = null;
  let running = false;

  const read = async () => {
    if (tail && (await tail.read()) && running) for (const l of listeners) l(tail.events());
  };

  return {
    async start() {
      if (running) return;
      await mkdir(dirname(file), { recursive: true });
      await (await open(file, 'a')).close();
      running = true;
      tail = await createEventsTail(file);
      await read();
      const { watch } = await import('chokidar');
      fsw = watch(file, { ignoreInitial: true });
      fsw.on('add', () => void read());
      fsw.on('change', () => void read());
      fsw.on('error', () => {});
      await new Promise<void>((resolve) => fsw!.once('ready', () => resolve()));
      // eventuali append avvenuti prima che il watcher fosse pronto
      await read();
    },
    async stop() {
      running = false;
      const w = fsw;
      fsw = null;
      await w?.close();
      await tail?.read().catch(() => false);
    },
    current: () => tail?.events() ?? [],
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Eventi di tutte le cartelle (app della menu bar): un solo watcher sulla cartella <dataDir>/events e una lettura
 * incrementale per ogni file, compresi quelli creati dopo l'avvio. Eventi delle ultime MERGE_WINDOW_MS uniti in
 * ordine di timestamp: un limite per numero farebbe uscire gli eventi delle sessioni poco attive quando un'altra
 * ne produce tanti.
 */
export function createAllHookEventsWatcher(opts: HookPathsOptions & { now?: () => number } = {}): Watcher<HookEvent[]> {
  const now = opts.now ?? Date.now;
  const dir = dirname(eventsFilePath('/', opts));
  const tails = new Map<string, Promise<EventsTail>>();
  const listeners = new Set<(v: HookEvent[]) => void>();
  let events: HookEvent[] = [];
  let fsw: FSWatcher | null = null;
  let running = false;

  const merge = async () => {
    const since = now() - MERGE_WINDOW_MS;
    const all = await Promise.all(tails.values());
    // ogni file tiene solo gli eventi della finestra: quelli vecchi non servono più a nessuno (fino a MAX_EVENTS per file)
    for (const t of all) t.prune(since);
    events = all.flatMap((t) => t.events()).sort((a, b) => a.timestamp - b.timestamp);
    if (running) for (const l of listeners) l(events);
  };

  /** file nuovo o modificato: lettura incrementale e, se ci sono eventi nuovi, unione */
  const read = async (file: string) => {
    if (!file.endsWith('.jsonl')) return;
    let tail = tails.get(file);
    if (!tail) tails.set(file, (tail = createEventsTail(file)));
    if (await (await tail).read()) await merge();
  };

  return {
    async start() {
      if (running) return;
      await mkdir(dir, { recursive: true });
      running = true;
      const { watch } = await import('chokidar');
      const initial: Promise<void>[] = [];
      fsw = watch(dir, { depth: 0 });
      fsw.on('add', (file) => void initial.push(read(file)));
      fsw.on('change', (file) => void read(file));
      fsw.on('error', () => {});
      await new Promise<void>((resolve) => fsw!.once('ready', () => resolve()));
      await Promise.all(initial);
      fsw.removeAllListeners('add');
      fsw.on('add', (file) => void read(file));
    },
    async stop() {
      running = false;
      const w = fsw;
      fsw = null;
      await w?.close();
      tails.clear();
    },
    current: () => events,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
