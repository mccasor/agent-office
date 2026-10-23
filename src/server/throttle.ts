export interface Throttle {
  /** chiede un'esecuzione: parte dopo delayMs, ma mai prima di intervalMs dalla precedente */
  schedule(): void;
  /** annulla l'esecuzione in attesa */
  cancel(): void;
}

/**
 * Raggruppa le richieste di esecuzione: `fn` parte al più una volta ogni `intervalMs`. Dopo una pausa la prima
 * richiesta parte dopo `delayMs` (accorpa la raffica che segue); durante l'attesa le richieste si sommano in una
 * sola esecuzione finale, che arriva sempre: nessuna modifica resta indietro per più di `intervalMs`.
 */
export function createThrottle(fn: () => void, opts: { delayMs: number; intervalMs: number; now?: () => number }): Throttle {
  const now = opts.now ?? Date.now;
  let timer: NodeJS.Timeout | null = null;
  let lastRun = -Infinity;
  const run = () => {
    timer = null;
    lastRun = now();
    fn();
  };
  return {
    schedule() {
      timer ??= setTimeout(run, Math.max(opts.delayMs, lastRun + opts.intervalMs - now()));
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
