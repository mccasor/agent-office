import { describe, expect, it } from 'vitest';
import { byUrgency, contextLevel, effectiveInput, elapsed, formatCost, formatDuration, formatTokens, percent } from './format';
import { compactionText, stateCounts, statusText, turnText } from './labels';

describe('formatTokens', () => {
  it.each([
    [0, '0'],
    [7, '7'],
    [999, '999'],
    [1000, '1k'],
    [1234, '1.2k'],
    [12_345, '12.3k'],
    [99_999, '100k'],
    [123_456, '123k'],
    [999_999, '1M'],
    [1_000_000, '1M'],
    [2_500_000, '2.5M'],
    [12_340_000, '12.3M'],
    [3_200_000_000, '3.2B'],
    [-1234, '-1.2k'],
    [12.7, '13'],
  ])('%d → %s', (n, out) => {
    expect(formatTokens(n)).toBe(out);
  });

  it('valori non finiti → "0"', () => {
    expect(formatTokens(Number.NaN)).toBe('0');
    expect(formatTokens(Number.POSITIVE_INFINITY)).toBe('0');
  });
});

describe('percent', () => {
  it('calcola e limita 0..100, null se totale non valido', () => {
    expect(percent(1, 4)).toBe(25);
    expect(percent(2, 3)).toBe(67);
    expect(percent(5, 4)).toBe(100);
    expect(percent(-1, 4)).toBe(0);
    expect(percent(1, 0)).toBeNull();
    expect(percent(1, null)).toBeNull();
  });
});

describe('contextLevel', () => {
  it('ok ≤70, warn >70, danger >90', () => {
    expect(contextLevel(70)).toBe('ok');
    expect(contextLevel(71)).toBe('warn');
    expect(contextLevel(90)).toBe('warn');
    expect(contextLevel(91)).toBe('danger');
  });
});

describe('formatDuration / elapsed', () => {
  it('minuti, ore e ore con minuti', () => {
    expect(formatDuration(30_000)).toBe('<1 min');
    expect(formatDuration(-5)).toBe('<1 min');
    expect(formatDuration(12 * 60_000 + 59_000)).toBe('12 min');
    expect(formatDuration(120 * 60_000)).toBe('2 h');
    expect(formatDuration(125 * 60_000)).toBe('2 h 05');
  });

  it('chi lavora conta fino a ora, chi ha finito fino all\'ultimo aggiornamento', () => {
    expect(elapsed({ status: 'working', startedAt: 1000, updatedAt: 2000 }, 9000)).toBe(8000);
    expect(elapsed({ status: 'done', startedAt: 1000, updatedAt: 2000 }, 9000)).toBe(1000);
  });
});

describe('formatCost', () => {
  it('due decimali con la virgola, soglia minima, trattino se sconosciuto', () => {
    expect(formatCost(0.4249)).toBe('≈ $0,42');
    expect(formatCost(12.5)).toBe('≈ $12,50');
    expect(formatCost(0.004)).toBe('< $0,01');
    expect(formatCost(null)).toBe('—');
    expect(formatCost(undefined)).toBe('—');
  });
});

describe('urgenza, stato e turno', () => {
  const now = 10 * 3_600_000;
  it('byUrgency: in attesa, al lavoro, inattivi, terminati; a parità l\'ordine di arrivo', () => {
    const list = [
      { id: 'd', status: 'done' },
      { id: 'i', status: 'idle' },
      { id: 'w', status: 'working' },
      { id: 'e', status: 'entering' },
      { id: 'q', status: 'working', waiting: true },
    ];
    expect(byUrgency(list).map((a) => a.id)).toEqual(['q', 'w', 'e', 'i', 'd']);
    expect(list[0]!.id).toBe('d');
  });

  it('stateCounts: solo le voci non zero, singolare e plurale', () => {
    expect(stateCounts([])).toBe('');
    expect(stateCounts([{ status: 'working' }, { status: 'working' }, { status: 'done' }])).toBe('2 al lavoro · 1 terminato');
    expect(stateCounts([{ status: 'idle' }, { status: 'idle' }, { status: 'working', waiting: true }])).toBe('1 in attesa · 2 inattivi');
  });

  it('statusText: attesa, tool da quanto, fermo da quanto', () => {
    const tool = { name: 'Bash', target: null, since: now - 4 * 60_000 };
    expect(statusText({ status: 'working', updatedAt: now, tool }, now)).toBe('al lavoro · Bash da 4 min');
    expect(statusText({ status: 'working', updatedAt: now, tool: { ...tool, since: now - 5_000 } }, now)).toBe('al lavoro · Bash');
    expect(statusText({ status: 'idle', updatedAt: now - 12 * 60_000, tool }, now)).toBe('Bash da 4 min');
    expect(statusText({ status: 'idle', updatedAt: now - 12 * 60_000 }, now)).toBe('fermo da 12 min');
    expect(statusText({ status: 'idle', updatedAt: now, waiting: true, waitingKind: 'plan', waitingSince: null }, now)).toBe('aspetta l\'ok al piano');
    expect(statusText({ status: 'done', updatedAt: 0, tool }, now)).toBe('terminato');
  });

  it('turnText: turno in corso, altrimenti l\'ultimo chiuso', () => {
    expect(turnText({ status: 'working', turnStartedAt: now - 3 * 60_000, lastTurnMs: 60_000 }, now)).toBe('turno da 3 min');
    expect(turnText({ status: 'done', turnStartedAt: now - 3 * 60_000, lastTurnMs: 12 * 60_000 }, now)).toBe('ultimo turno 12 min');
    expect(turnText({ status: 'done' }, now)).toBeNull();
  });

  it('compactionText ed effectiveInput', () => {
    expect(compactionText(0, null)).toBeNull();
    expect(compactionText(1, { at: 0, trigger: 'manual', preTokens: 699_680, postTokens: 12_385 })).toBe('compattato 1 volta · ultima 700k → 12.4k (manuale)');
    expect(effectiveInput({ input: 2, cacheCreation: 1000 })).toBe(1002);
  });
});
