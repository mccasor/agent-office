import * as fsp from 'node:fs/promises';
import { mkdtemp, rm, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionProcesses, systemProbe, type ProcessProbe } from './index.js';

// readFile e stat osservati: i file .key della cartella non vanno mai aperti
vi.mock('node:fs/promises', async (orig) => {
  const real = await orig<typeof import('node:fs/promises')>();
  return { ...real, readFile: vi.fn(real.readFile), stat: vi.fn(real.stat) };
});

const SECRET = 'sk-ant-segretissimo-mai-da-leggere';
const START = 'Wed Oct 21 11:21:15 2026';

let dir: string;
let clock: number;

/** processi finti: pid → inizio (come ps); assenti = terminati */
function fakeProbe(procs: Map<number, string>): ProcessProbe & { psCalls: number[][] } {
  const psCalls: number[][] = [];
  return {
    psCalls,
    exists: (pid) => procs.has(pid),
    startTimes: async (pids) => {
      psCalls.push(pids);
      return new Map(pids.filter((p) => procs.has(p)).map((p) => [p, procs.get(p)!]));
    },
  };
}

const sessionFile = (pid: number, sessionId: string, over: Record<string, unknown> = {}) =>
  writeFile(join(dir, `${pid}.json`), JSON.stringify({ pid, sessionId, cwd: '/x', procStart: START, status: 'busy', messagingSocketPath: '/tmp/s', ...over }));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ao-sessions-'));
  clock = 1_000_000;
  vi.mocked(fsp.readFile).mockClear();
  vi.mocked(fsp.stat).mockClear();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('createSessionProcesses (#104)', () => {
  it('legge solo i <pid>.json: il file .key non viene mai aperto né guardato', async () => {
    await sessionFile(100, 's-vivo');
    await writeFile(join(dir, `100.${'ab'.repeat(8)}.key`), SECRET);
    await writeFile(join(dir, 'note.json.bak'), SECRET);
    const sp = createSessionProcesses({ dir, probe: fakeProbe(new Map([[100, START]])), now: () => clock });
    await sp.refresh(true);
    const touched = [...vi.mocked(fsp.readFile).mock.calls, ...vi.mocked(fsp.stat).mock.calls].map((c) => String(c[0]));
    expect(touched.length).toBeGreaterThan(0);
    expect(touched.every((p) => p.endsWith('/100.json'))).toBe(true);
    expect(JSON.stringify([...sp.current()])).not.toContain(SECRET);
    expect(sp.get('s-vivo')).toEqual({ process: 'alive', status: 'busy', goneAt: null });
  });

  it('processo vivo, morto e pid riusato (procStart diverso); senza file la sessione è sconosciuta', async () => {
    await sessionFile(100, 's-vivo', { status: 'idle' });
    await sessionFile(200, 's-morto');
    await sessionFile(300, 's-riusato');
    const probe = fakeProbe(new Map([[100, START], [300, 'Thu Oct 22 08:00:00 2026']]));
    const sp = createSessionProcesses({ dir, probe, now: () => clock });
    await sp.refresh(true);
    expect(sp.get('s-vivo')).toEqual({ process: 'alive', status: 'idle', goneAt: null });
    // già terminati alla prima lettura: senza l'ora della fine (non escono a passi dall'ufficio)
    expect(sp.get('s-morto')).toEqual({ process: 'gone', status: null, goneAt: null });
    expect(sp.get('s-riusato')).toEqual({ process: 'gone', status: null, goneAt: null });
    expect(sp.get('s-senza-file')).toBeUndefined();
    // un solo ps, solo per i pid che esistono
    expect(probe.psCalls).toEqual([[100, 300]]);
  });

  it('si accorge della fine anche quando il file sparisce (uscita normale) e ne ricorda l\'ora', async () => {
    await sessionFile(100, 's1');
    const procs = new Map([[100, START]]);
    const sp = createSessionProcesses({ dir, probe: fakeProbe(procs), now: () => clock });
    await sp.refresh(true);
    expect(sp.get('s1')?.process).toBe('alive');
    // Claude Code esce: toglie il file e il processo non c'è più
    procs.delete(100);
    await unlink(join(dir, '100.json'));
    clock += 6_000;
    expect(await sp.refresh()).toBe(true);
    expect(sp.get('s1')).toEqual({ process: 'gone', status: null, goneAt: clock });
    // resta terminata anche ai controlli successivi, con la stessa ora
    clock += 6_000;
    expect(await sp.refresh()).toBe(false);
    expect(sp.get('s1')?.goneAt).toBe(clock - 6_000);
  });

  it('file sparito ma processo vivo: la sessione torna sconosciuta; pid passato a un\'altra sessione (/clear): chiusa', async () => {
    await sessionFile(100, 's1');
    await sessionFile(200, 's2');
    const sp = createSessionProcesses({ dir, probe: fakeProbe(new Map([[100, START], [200, START]])), now: () => clock });
    await sp.refresh(true);
    await unlink(join(dir, '100.json'));
    await sessionFile(200, 's3');
    await sp.refresh(true);
    expect(sp.get('s1')).toBeUndefined();
    expect(sp.get('s2')?.process).toBe('gone');
    expect(sp.get('s3')?.process).toBe('alive');
  });

  it('rilegge solo i file cambiati, al più ogni minIntervalMs; ps riconferma il pid solo ogni recheckMs', async () => {
    await sessionFile(100, 's1');
    const probe = fakeProbe(new Map([[100, START]]));
    const sp = createSessionProcesses({ dir, probe, now: () => clock, minIntervalMs: 5_000, recheckMs: 60_000 });
    await sp.refresh(true);
    expect(vi.mocked(fsp.readFile)).toHaveBeenCalledTimes(1);
    clock += 1_000;
    expect(await sp.refresh()).toBe(false); // troppo presto: niente letture
    expect(vi.mocked(fsp.stat)).toHaveBeenCalledTimes(1);
    clock += 5_000;
    await sp.refresh();
    expect(vi.mocked(fsp.stat)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fsp.readFile)).toHaveBeenCalledTimes(1); // stesso mtime e dimensione
    expect(probe.psCalls).toHaveLength(1);
    // Claude Code aggiorna lo stato: il file cambia e si rilegge
    await sessionFile(100, 's1', { status: 'idle' });
    await utimes(join(dir, '100.json'), new Date(clock + 1), new Date(clock + 1));
    clock += 60_000;
    expect(await sp.refresh()).toBe(true);
    expect(vi.mocked(fsp.readFile)).toHaveBeenCalledTimes(2);
    expect(sp.get('s1')?.status).toBe('idle');
    expect(probe.psCalls).toHaveLength(2);
  });

  it('ps non disponibile: basta che il processo esista; file malformati e cartella assente non rompono nulla', async () => {
    await sessionFile(100, 's1');
    await writeFile(join(dir, '101.json'), '{ scritto a me');
    await writeFile(join(dir, '102.json'), JSON.stringify({ pid: 'x', sessionId: 's2' }));
    const probe: ProcessProbe = { exists: () => true, startTimes: () => Promise.reject(new Error('ps')) };
    const sp = createSessionProcesses({ dir, probe, now: () => clock });
    await sp.refresh(true);
    expect([...sp.current().keys()]).toEqual(['s1']);
    expect(sp.get('s1')?.process).toBe('alive');
    const missing = createSessionProcesses({ dir: join(dir, 'non-esiste'), probe, now: () => clock });
    expect(await missing.refresh(true)).toBe(false);
    expect(missing.current().size).toBe(0);
  });

  it('più file per la stessa sessione (ripresa in un altro processo): vale quello vivo', async () => {
    await sessionFile(100, 's1');
    await sessionFile(200, 's1', { status: 'idle' });
    const sp = createSessionProcesses({ dir, probe: fakeProbe(new Map([[200, START]])), now: () => clock });
    await sp.refresh(true);
    expect(sp.get('s1')).toEqual({ process: 'alive', status: 'idle', goneAt: null });
  });

  it('systemProbe: il processo dei test esiste e ps ne dà l\'inizio; un pid inesistente no', async () => {
    expect(systemProbe.exists(process.pid)).toBe(true);
    expect(systemProbe.exists(2 ** 22 + 12_345)).toBe(false);
    const starts = await systemProbe.startTimes([process.pid]);
    expect(starts.get(process.pid)).toMatch(/^\w{3} \w{3} +\d{1,2} \d\d:\d\d:\d\d \d{4}$/);
    // stesso inizio nel file: vivo; inizio diverso (pid riusato): terminato
    await sessionFile(process.pid, 'io', { procStart: starts.get(process.pid) });
    await sessionFile(1, 'init-riusato', { procStart: 'Mon Jan  1 00:00:00 2001' });
    const sp = createSessionProcesses({ dir, now: () => clock });
    await sp.refresh(true);
    expect(sp.get('io')?.process).toBe('alive');
    expect(sp.get('init-riusato')?.process).toBe('gone');
  });
});
