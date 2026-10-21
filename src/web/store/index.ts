import type { Snapshot } from '../../shared/types';

export interface OfficeStoreState {
  snapshot: Snapshot | null;
  connected: boolean;
  setSnapshot(snapshot: Snapshot): void;
  setConnected(connected: boolean): void;
}

/** hook zustand */
export declare const useOfficeStore: import('zustand').UseBoundStore<import('zustand').StoreApi<OfficeStoreState>>;

/** Apre l'EventSource su /api/events (con riconnessione) e aggiorna lo store. Ritorna la funzione di chiusura. */
export function connectSnapshotStream(_url?: string): () => void {
  throw new Error('not implemented');
}
