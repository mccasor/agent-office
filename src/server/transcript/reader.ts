import { open } from 'node:fs/promises';

export interface LineReader {
  /** Legge solo i byte aggiunti dall'ultima lettura. `reset` = il file è stato troncato/riscritto e la lettura è ripartita da 0. */
  read(): Promise<{ lines: string[]; reset: boolean }>;
  /** byte consumati fino all'ultima riga completa */
  readonly offset: number;
}

const NEWLINE = 0x0a;

/** Lettore incrementale per offset: mai rilegge il file, trattiene l'ultima riga incompleta. */
export function createLineReader(path: string): LineReader {
  let offset = 0;

  const read = async (): Promise<{ lines: string[]; reset: boolean }> => {
    let handle;
    try {
      handle = await open(path, 'r');
    } catch {
      return { lines: [], reset: false };
    }
    try {
      const { size } = await handle.stat();
      let reset = false;
      if (size < offset) {
        offset = 0;
        reset = true;
      }
      if (size === offset) return { lines: [], reset };

      const buffer = Buffer.alloc(size - offset);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      const chunk = buffer.subarray(0, bytesRead);
      const lastNewline = chunk.lastIndexOf(NEWLINE);
      if (lastNewline < 0) return { lines: [], reset };

      offset += lastNewline + 1;
      const lines = chunk
        .subarray(0, lastNewline)
        .toString('utf8')
        .split('\n')
        .map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
        .filter((l) => l.length > 0);
      return { lines, reset };
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
