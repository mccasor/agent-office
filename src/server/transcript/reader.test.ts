import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLineReader } from './reader.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ao-reader-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('createLineReader', () => {
  it('legge solo le righe nuove a partire dall’ultimo offset', async () => {
    const file = join(dir, 'a.jsonl');
    await writeFile(file, 'one\ntwo\n');
    const reader = createLineReader(file);
    expect(await reader.read()).toEqual({ lines: ['one', 'two'], reset: false, more: false });
    expect(await reader.read()).toEqual({ lines: [], reset: false, more: false });
    await appendFile(file, 'three\n');
    expect(await reader.read()).toEqual({ lines: ['three'], reset: false, more: false });
    expect(reader.offset).toBe(Buffer.byteLength('one\ntwo\nthree\n'));
  });

  it('trattiene la riga parziale finché non arriva il newline (anche a metà di un carattere multibyte)', async () => {
    const file = join(dir, 'b.jsonl');
    const full = Buffer.from('{"t":"è"}\n');
    const cut = full.indexOf(0xa8); // secondo byte di "è"
    await writeFile(file, full.subarray(0, cut));
    const reader = createLineReader(file);
    expect((await reader.read()).lines).toEqual([]);
    await appendFile(file, full.subarray(cut));
    expect((await reader.read()).lines).toEqual(['{"t":"è"}']);
  });

  it('gestisce CRLF', async () => {
    const file = join(dir, 'c.jsonl');
    await writeFile(file, 'a\r\nb\r\n');
    expect((await createLineReader(file).read()).lines).toEqual(['a', 'b']);
  });

  it('se il file viene troncato riparte da zero e segnala reset', async () => {
    const file = join(dir, 'd.jsonl');
    await writeFile(file, 'aaaa\nbbbb\n');
    const reader = createLineReader(file);
    await reader.read();
    await writeFile(file, 'c\n');
    expect(await reader.read()).toEqual({ lines: ['c'], reset: true, more: false });
  });

  it('legge a blocchi di maxBytes; una riga più lunga del blocco viene letta intera', async () => {
    const file = join(dir, 'e.jsonl');
    await writeFile(file, 'aaa\nbbb\n' + 'x'.repeat(20) + '\nccc\n');
    const reader = createLineReader(file, 8);
    expect(await reader.read()).toEqual({ lines: ['aaa', 'bbb'], reset: false, more: true });
    // nessun a capo negli 8 byte: il blocco raddoppia finché ne trova uno
    expect(await reader.read()).toEqual({ lines: ['x'.repeat(20), 'ccc'], reset: false, more: false });
  });

  it('file mancante: nessuna riga, nessun errore', async () => {
    const reader = createLineReader(join(dir, 'missing.jsonl'));
    expect(await reader.read()).toEqual({ lines: [], reset: false, more: false });
  });
});
