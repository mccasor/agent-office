import { useSyncExternalStore } from 'react';

const TICK_MS = 15_000;
const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // un solo intervallo condiviso da tutte le etichette, attivo solo finché qualcuno lo usa
  if (!timer) now = Date.now(); // dopo un periodo senza iscritti il valore può essere vecchio
  timer ??= setInterval(() => {
    now = Date.now();
    for (const l of listeners) l();
  }, TICK_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Ora corrente aggiornata ogni 15 s: basta per le durate in minuti. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => now);
}
