import { mkdir, open, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { FSWatcher } from 'chokidar';
import type { HookEvent, Watcher } from '../../shared/types.js';
import { eventsFilePath, parseEventLine, type HookPathsOptions } from './events.js';

export const MAX_EVENTS = 2000;

/** Tail incrementale (per offset) del file eventi dell'hook di una cartella (o del file indicato). */
export function createHookEventsWatcher(opts: ({ cwd: string } | { file: string }) & HookPathsOptions): Watcher<HookEvent[]> {
  const file = 'file' in opts ? opts.file : eventsFilePath(opts.cwd, opts);
  const listeners = new Set<(v: HookEvent[]) => void>();
  let events: HookEvent[] = [];
  let offset = 0;
  let partial = '';
  let fsw: FSWatcher | null = null;
  let running = false;
  let queue: Promise<void> = Promise.resolve();

  async function readNew(): Promise<void> {
    const { size } = await stat(file);
    let reset = false;
    if (size < offset) {
      // file troncato o ricreato: si riparte da capo
      offset = 0;
      partial = '';
      reset = events.length > 0;
      events = [];
    }
    if (size === offset) {
      if (reset) emit();
      return;
    }
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
    // le righe sono UTF-8: si spezza solo su '\n' (byte mai interno a sequenze multibyte)
    const nl = chunk.lastIndexOf(0x0a);
    if (nl === -1) {
      partial += chunk.toString('utf8');
      if (reset) emit();
      return;
    }
    const text = partial + chunk.subarray(0, nl).toString('utf8');
    partial = chunk.subarray(nl + 1).toString('utf8');
    const fresh: HookEvent[] = [];
    for (const line of text.split('\n')) {
      const e = line.trim() ? parseEventLine(line) : null;
      if (e) fresh.push(e);
    }
    if (fresh.length === 0 && !reset) return;
    events = events.concat(fresh);
    if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);
    emit();
  }

  function emit(): void {
    if (!running) return;
    for (const l of listeners) l(events);
  }

  function schedule(): Promise<void> {
    queue = queue.then(readNew).catch(() => {});
    return queue;
  }

  return {
    async start() {
      if (running) return;
      await mkdir(dirname(file), { recursive: true });
      await (await open(file, 'a')).close();
      running = true;
      await schedule();
      const { watch } = await import('chokidar');
      fsw = watch(file, { ignoreInitial: true });
      fsw.on('add', () => void schedule());
      fsw.on('change', () => void schedule());
      fsw.on('error', () => {});
      await new Promise<void>((resolve) => fsw!.once('ready', () => resolve()));
      // eventuali append avvenuti prima che il watcher fosse pronto
      await schedule();
    },
    async stop() {
      running = false;
      const w = fsw;
      fsw = null;
      await w?.close();
      await queue;
    },
    current: () => events,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Eventi di tutte le cartelle (app della menu bar): un tail per ogni file in <dataDir>/events, compresi quelli
 * creati dopo l'avvio. Eventi uniti in ordine di timestamp, al più MAX_EVENTS.
 */
export function createAllHookEventsWatcher(opts: HookPathsOptions = {}): Watcher<HookEvent[]> {
  const dir = dirname(eventsFilePath('/', opts));
  const tails = new Map<string, Watcher<HookEvent[]>>();
  const listeners = new Set<(v: HookEvent[]) => void>();
  let events: HookEvent[] = [];
  let fsw: FSWatcher | null = null;
  let running = false;

  const merge = () => {
    events = [...tails.values()]
      .flatMap((t) => t.current())
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-MAX_EVENTS);
    if (running) for (const l of listeners) l(events);
  };

  const follow = async (file: string) => {
    if (!file.endsWith('.jsonl') || tails.has(file)) return;
    const tail = createHookEventsWatcher({ file });
    tails.set(file, tail);
    tail.onChange(merge);
    await tail.start();
    merge();
  };

  return {
    async start() {
      if (running) return;
      await mkdir(dir, { recursive: true });
      running = true;
      const { watch } = await import('chokidar');
      const initial: Promise<void>[] = [];
      fsw = watch(dir, { depth: 0 });
      fsw.on('add', (file) => void initial.push(follow(file)));
      fsw.on('error', () => {});
      await new Promise<void>((resolve) => fsw!.once('ready', () => resolve()));
      await Promise.all(initial);
      fsw.removeAllListeners('add');
      fsw.on('add', (file) => void follow(file));
    },
    async stop() {
      running = false;
      const w = fsw;
      fsw = null;
      await w?.close();
      await Promise.all([...tails.values()].map((t) => t.stop()));
      tails.clear();
    },
    current: () => events,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
