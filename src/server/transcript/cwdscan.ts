import { createReadStream } from 'node:fs';

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
/** campo `cwd` nel JSON compatto scritto da Claude Code; nel testo dei messaggi è escapato (`\"cwd\":\"`) e non corrisponde */
const NEEDLE = Buffer.from('"cwd":"');
/** valore di `cwd` oltre questa lunghezza senza virgolette di chiusura: non è un path, si ignora */
const MAX_VALUE = 4096;

export interface CwdScan {
  /** la sessione appartiene alla cartella monitorata */
  match: boolean;
  /** senza match: offset da cui riprendere quando il file cresce */
  offset: number;
  /** cartella di avvio (prima riga con `cwd`) già vista: superiore a quella monitorata */
  started: boolean;
  /** cartella di avvio estranea (né interna né superiore): la sessione non è della cartella monitorata */
  rejected: boolean;
}

/** `child` è `parent` o è interno ad essa (separatori `/` e `\`) */
function within(child: string, parent: string): boolean {
  const base = parent.replace(/[\\/]+$/, '');
  if (child === base) return true;
  const sep = child[base.length];
  return child.startsWith(base) && (sep === '/' || sep === '\\');
}

/** indice delle virgolette di chiusura della stringa JSON che inizia a `from`, -1 se non è nel buffer */
function closingQuote(buf: Buffer, from: number): number {
  for (let j = from; j < buf.length; j++) {
    if (buf[j] === BACKSLASH) j++;
    else if (buf[j] === QUOTE) return j;
  }
  return -1;
}

/**
 * Attribuzione della sessione per cartella di avvio (#115), in streaming dal byte `from`, senza parsing delle righe.
 * La prima riga con `cwd` decide: interna alla cartella monitorata -> match; superiore -> si attende una riga
 * successiva con `cwd` interno (`started`); altrimenti la sessione è scartata (`rejected`) anche se poi ci passa.
 * `started` va ripassato riprendendo da `offset`, perché la prima riga con `cwd` può essere nei byte già letti.
 */
export async function scanCwd(path: string, dir: string, from = 0, chunkSize = 64 * 1024, started = false): Promise<CwdScan> {
  const stream = createReadStream(path, { start: from, highWaterMark: chunkSize });
  let carry: Buffer = Buffer.alloc(0);
  /** offset assoluto di `carry[0]` */
  let offset = from;
  const done = (match: boolean, rejected: boolean): CwdScan => ({ match, offset, started, rejected });
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      const buf = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
      // il needle (o il valore che segue) può stare a cavallo del prossimo chunk
      let keep = Math.max(0, buf.length - NEEDLE.length + 1);
      for (let i = buf.indexOf(NEEDLE); i >= 0; i = buf.indexOf(NEEDLE, i + 1)) {
        const start = i + NEEDLE.length;
        const end = closingQuote(buf, start);
        if (end < 0) {
          if (buf.length - start <= MAX_VALUE) keep = i;
          break;
        }
        let cwd: string;
        try {
          cwd = JSON.parse(buf.toString('utf8', start - 1, end + 1)) as string;
        } catch {
          continue;
        }
        if (within(cwd, dir)) return done(true, false);
        if (started) continue;
        if (!within(dir, cwd)) return done(false, true);
        started = true;
      }
      carry = buf.subarray(keep);
      offset += buf.length - carry.length;
    }
  } catch {
    return { match: false, offset: from, started, rejected: false };
  } finally {
    stream.destroy();
  }
  return done(false, false);
}
