import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLaunchedWatcher, launchedFilePath, parseLaunched, type LaunchedSession } from './launched.js';

const ID = '33333333-3333-4333-8333-333333333333';
const entry = (over: Record<string, unknown> = {}) => ({ sessionId: ID, pid: 4242, cwd: '/w/progetto', launchedAt: 1_763_380_000_000, ...over });
const SESSION: LaunchedSession = { sessionId: ID, pid: 4242, cwd: '/w/progetto', launchedAt: 1_763_380_000_000 };

describe('parseLaunched', () => {
  it('sessioni valide, campi sconosciuti ignorati', () => {
    expect(parseLaunched({ version: 1, sessions: [{ ...entry(), extra: 'x' }] })).toEqual([SESSION]);
  });

  it('file assente, malformato o di forma sconosciuta: nessuna sessione', () => {
    for (const raw of [undefined, null, 'x', 42, [], {}, { sessions: 'x' }, { sessions: {} }]) expect(parseLaunched(raw)).toEqual([]);
  });

  it('scarta le voci non valide: uuid, pid, cwd relativo, launchedAt', () => {
    const bad = [
      entry({ sessionId: 'non-un-uuid' }),
      entry({ sessionId: '../../etc/passwd' }),
      entry({ pid: 0 }),
      entry({ pid: -1 }),
      entry({ pid: 1.5 }),
      entry({ pid: '4242' }),
      entry({ cwd: 'relativo/path' }),
      entry({ cwd: '' }),
      entry({ launchedAt: 'ieri' }),
      null,
      'x',
    ];
    expect(parseLaunched({ version: 1, sessions: [...bad, entry()] })).toEqual([SESSION]);
  });

  it('stessa sessione due volte: vale la prima', () => {
    expect(parseLaunched({ sessions: [entry(), entry({ pid: 9 })] })).toEqual([SESSION]);
  });
});

describe('createLaunchedWatcher', () => {
  let dataDir: string;
  let file: string;
  let w: ReturnType<typeof createLaunchedWatcher> | null = null;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'ao-launched-'));
    file = launchedFilePath({ dataDir });
  });

  afterEach(async () => {
    await w?.stop();
    w = null;
    await rm(dataDir, { recursive: true, force: true });
  });

  /** come l'app: file temporaneo e rename */
  const write = async (body: string) => {
    await writeFile(`${file}.tmp`, body);
    await rename(`${file}.tmp`, file);
  };

  it('il file sta in <dataDir>/launched.json', () => {
    expect(file).toBe(join(dataDir, 'launched.json'));
  });

  it('file assente o non valido: nessuna sessione, nessun errore', async () => {
    w = createLaunchedWatcher({ file, tickMs: 50, exists: () => true });
    await w.start();
    expect(w.current()).toEqual([]);
    await write('{non json');
    await new Promise((r) => setTimeout(r, 150));
    expect(w.current()).toEqual([]);
  });

  it('legge il file all’avvio e segue le sostituzioni (rename) con notifica', async () => {
    await write(JSON.stringify({ version: 1, sessions: [entry()] }));
    w = createLaunchedWatcher({ file, tickMs: 50, exists: () => true });
    await w.start();
    expect(w.current()).toEqual([SESSION]);
    const seen: LaunchedSession[][] = [];
    w.onChange((v) => seen.push(v));
    await write(JSON.stringify({ version: 1, sessions: [] }));
    await vi.waitFor(() => expect(w!.current()).toEqual([]), { timeout: 3000, interval: 20 });
    expect(seen.at(-1)).toEqual([]);
  });

  it('processo non più esistente (app chiusa senza togliere la voce): sessione esclusa', async () => {
    let alive = true;
    await write(JSON.stringify({ version: 1, sessions: [entry()] }));
    w = createLaunchedWatcher({ file, tickMs: 50, exists: () => alive });
    await w.start();
    expect(w.current()).toEqual([SESSION]);
    alive = false;
    await vi.waitFor(() => expect(w!.current()).toEqual([]), { timeout: 3000, interval: 20 });
  });
});
