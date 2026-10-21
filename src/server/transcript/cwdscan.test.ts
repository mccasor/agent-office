import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanCwd } from './cwdscan.js';

let dir: string;
let file: string;
const row = (cwd: string) => JSON.stringify({ type: 'user', cwd, message: { content: `"cwd":"/w/app"` } }) + '\n';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ao-cwdscan-'));
  file = join(dir, 's.jsonl');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('scanCwd', () => {
  it.each([
    ['/w/app', true],
    ['/w/app/src', true],
    ['/w/app/', true],
    ['/w', false],
    ['/w/app-other', false],
    ['/w/apps/x', false],
  ])('cwd %s -> %s', async (cwd, expected) => {
    await writeFile(file, row('/w') + row(cwd));
    expect((await scanCwd(file, '/w/app')).match).toBe(expected);
  });

  it('match a cavallo dei chunk, per ogni dimensione di chunk', async () => {
    await writeFile(file, row('/w') + row('/w/app/src'));
    for (let size = 1; size < 40; size++) expect((await scanCwd(file, '/w/app', 0, size)).match).toBe(true);
  });

  it('nessun match: offset per riprendere solo dai byte nuovi', async () => {
    await writeFile(file, row('/w'));
    const first = await scanCwd(file, '/w/app', 0, 8);
    expect(first.match).toBe(false);
    expect(first.offset).toBeGreaterThan(0);
    await appendFile(file, row('/w/app'));
    expect((await scanCwd(file, '/w/app', first.offset, 8)).match).toBe(true);
  });

  it('cartella monitorata "/" con slash finale: ogni cwd è interno', async () => {
    await writeFile(file, row('/x'));
    expect((await scanCwd(file, '/')).match).toBe(true);
  });

  it('file inesistente: nessun match, nessun errore', async () => {
    expect(await scanCwd(join(dir, 'missing.jsonl'), '/w/app')).toEqual({ match: false, offset: 0 });
  });
});
