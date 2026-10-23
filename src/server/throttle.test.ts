import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createThrottle } from './throttle.js';

describe('createThrottle', () => {
  beforeEach(() => vi.useFakeTimers({ now: 0 }));
  afterEach(() => vi.useRealTimers());

  it('dopo una pausa parte subito (dopo delayMs) e accorpa la raffica', () => {
    const fn = vi.fn();
    const t = createThrottle(fn, { delayMs: 150, intervalMs: 1000 });
    t.schedule();
    t.schedule();
    vi.advanceTimersByTime(149);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('al più una volta al secondo sotto carico, con l’esecuzione finale garantita', () => {
    const fn = vi.fn();
    const t = createThrottle(fn, { delayMs: 150, intervalMs: 1000 });
    const runs: number[] = [];
    fn.mockImplementation(() => runs.push(Date.now()));
    // una richiesta ogni 20 ms per 3 s
    for (let i = 0; i < 150; i++) {
      t.schedule();
      vi.advanceTimersByTime(20);
    }
    vi.advanceTimersByTime(2000);
    expect(runs[0]).toBe(150);
    for (let i = 1; i < runs.length; i++) expect(runs[i]! - runs[i - 1]!).toBeGreaterThanOrEqual(1000);
    // l'ultima richiesta (a 2980 ms) è servita entro un secondo
    expect(runs.at(-1)).toBeGreaterThanOrEqual(2980);
    expect(runs.at(-1)! - 2980).toBeLessThanOrEqual(1000);
    expect(runs).toHaveLength(4);
  });

  it('una richiesta durante l’esecuzione produce un’altra esecuzione', () => {
    const runs: number[] = [];
    const t = createThrottle(() => {
      runs.push(Date.now());
      if (runs.length === 1) t.schedule();
    }, { delayMs: 0, intervalMs: 1000 });
    t.schedule();
    vi.advanceTimersByTime(5000);
    expect(runs).toEqual([0, 1000]);
  });

  it('cancel annulla l’esecuzione in attesa', () => {
    const fn = vi.fn();
    const t = createThrottle(fn, { delayMs: 150, intervalMs: 1000 });
    t.schedule();
    t.cancel();
    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
  });
});
