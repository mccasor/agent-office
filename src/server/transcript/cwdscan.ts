import { createReadStream } from 'node:fs';

const QUOTE = 0x22;
const SLASH = 0x2f;
const BACKSLASH = 0x5c;

/**
 * Cerca in streaming, dal byte `from`, una riga del transcript con campo `cwd` uguale a `dir` o interno ad essa.
 * Confronto sui byte del JSON compatto scritto da Claude Code (`"cwd":"<path>"`), senza parsing delle righe;
 * le occorrenze dentro stringhe (testo dei messaggi) sono escapate (`\"cwd\"`) e non corrispondono.
 * Si ferma al primo match. Senza match restituisce l'offset da cui riprendere quando il file cresce.
 */
export async function scanCwd(path: string, dir: string, from = 0, chunkSize = 64 * 1024): Promise<{ match: boolean; offset: number }> {
  const base = dir.length > 1 ? dir.replace(/[\\/]+$/, '') : '';
  const needle = Buffer.from(`"cwd":${JSON.stringify(base).slice(0, -1)}`);
  const stream = createReadStream(path, { start: from, highWaterMark: chunkSize });
  let carry: Buffer = Buffer.alloc(0);
  let offset = from;
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      const buf = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
      for (let i = buf.indexOf(needle); i >= 0; i = buf.indexOf(needle, i + 1)) {
        const next = buf[i + needle.length];
        if (next === QUOTE || next === SLASH || next === BACKSLASH) return { match: true, offset };
      }
      offset += chunk.length;
      // il needle (più il byte successivo) può stare a cavallo del prossimo chunk
      carry = buf.subarray(Math.max(0, buf.length - needle.length));
    }
  } catch {
    return { match: false, offset: from };
  } finally {
    stream.destroy();
  }
  return { match: false, offset: Math.max(from, offset - needle.length) };
}
