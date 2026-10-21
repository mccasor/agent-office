import type { Snapshot } from '../../shared/types.js';

export interface OfficeServer {
  url: string;
  publish(snapshot: Snapshot): void;
  close(): Promise<void>;
}

/** Ascolta solo su 127.0.0.1. GET /api/snapshot, GET /api/events (SSE), statici da webDir. */
export function startServer(_opts: { port: number; webDir: string; initial: Snapshot }): Promise<OfficeServer> {
  throw new Error('not implemented');
}
