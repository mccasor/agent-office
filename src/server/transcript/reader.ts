import { open } from 'node:fs/promises';

export interface LineReader {
  /**
   * Legge i byte aggiunti dall'ultima lettura, al più `maxBytes` per volta (di più solo se una riga è più lunga).
   * `reset` = il file è stato troncato/riscritto e la lettura è ripartita da 0; `more` = restano byte da leggere.
   */
  read(): Promise<ReadResult>;
  /** byte consumati fino all'ultima riga completa */
  readonly offset: number;
}

export interface ReadResult {
  lines: string[];
  reset: boolean;
  more: boolean;
}

const NEWLINE = 0x0a;
/** blocco massimo per lettura: un transcript di centinaia di MB non va caricato in memoria tutto insieme */
export const MAX_READ_BYTES = 4 * 1024 * 1024;

/** Lettore incrementale per offset: mai rilegge il file, trattiene l'ultima riga incompleta. */
export function createLineReader(path: string, maxBytes = MAX_READ_BYTES): LineReader {
  let offset = 0;

  const read = async (): Promise<ReadResult> => {
    let handle;
    try {
      handle = await open(path, 'r');
    } catch {
      return { lines: [], reset: false, more: false };
    }
    try {
      const { size } = await handle.stat();
      let reset = false;
      if (size < offset) {
        offset = 0;
        reset = true;
      }
      const available = size - offset;
      if (available === 0) return { lines: [], reset, more: false };

      // un blocco alla volta; se non contiene un a capo (riga lunghissima) lo si raddoppia
      let want = Math.min(available, maxBytes);
      let chunk: Buffer;
      let lastNewline: number;
      for (;;) {
        const buffer = Buffer.alloc(want);
        const { bytesRead } = await handle.read(buffer, 0, want, offset);
        chunk = buffer.subarray(0, bytesRead);
        lastNewline = chunk.lastIndexOf(NEWLINE);
        if (lastNewline >= 0 || want >= available) break;
        want = Math.min(available, want * 2);
      }
      if (lastNewline < 0) return { lines: [], reset, more: false };

      offset += lastNewline + 1;
      const lines = chunk
        .subarray(0, lastNewline)
        .toString('utf8')
        .split('\n')
        .map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
        .filter((l) => l.length > 0);
      return { lines, reset, more: offset < size };
    } finally {
      await handle.close();
    }
  };

  return {
    read,
    get offset() {
      return offset;
    },
  };
}
