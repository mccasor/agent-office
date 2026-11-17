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

  it('sessione avviata in /a che tocca /b una volta: monitorando /b è scartata (#115)', async () => {
    await writeFile(file, row('/a') + row('/b') + row('/a'));
    for (let size = 1; size < 40; size++) {
      expect(await scanCwd(file, '/b', 0, size)).toMatchObject({ match: false, rejected: true });
    }
  });

  it('sessione avviata in /parent che lavora in /parent/b: inclusa, anche passando altrove (#115)', async () => {
    await writeFile(file, row('/parent') + row('/altro') + row('/parent/b/src'));
    for (let size = 1; size < 40; size++) expect((await scanCwd(file, '/parent/b', 0, size)).match).toBe(true);
  });

  it('ripresa incrementale: la cartella di avvio superiore resta nota tra le chiamate (#115)', async () => {
    await writeFile(file, '{"type":"ai-title"}\n');
    const none = await scanCwd(file, '/parent/b');
    expect(none).toMatchObject({ match: false, rejected: false, started: false });
    await appendFile(file, row('/parent'));
    const first = await scanCwd(file, '/parent/b', none.offset, 8, none.started);
    expect(first).toMatchObject({ match: false, rejected: false, started: true });
    await appendFile(file, row('/altro') + row('/parent/b'));
    expect((await scanCwd(file, '/parent/b', first.offset, 8, first.started)).match).toBe(true);
  });

  it('ripresa incrementale: la prima riga con cwd nei byte nuovi decide se scartare (#115)', async () => {
    await writeFile(file, '{"type":"ai-title"}\n');
    const none = await scanCwd(file, '/b');
    await appendFile(file, row('/a') + row('/b'));
    expect(await scanCwd(file, '/b', none.offset, 8, none.started)).toMatchObject({ match: false, rejected: true });
  });

  it('file inesistente: nessun match, nessun errore', async () => {
    expect(await scanCwd(join(dir, 'missing.jsonl'), '/w/app')).toMatchObject({ match: false, offset: 0, rejected: false });
  });
});
