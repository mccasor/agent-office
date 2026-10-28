import { describe, expect, it } from 'vitest';
import { createGitReports } from './day.js';

describe('createGitReports', () => {
  const now = () => new Date(2026, 9, 28, 15).getTime();

  it('giorno non valido: null; senza giorno: oggi, sempre tra i giorni', async () => {
    const reports = createGitReports({ now, run: async () => ({ ok: false, missing: false }) });
    expect(await reports.report('/x', '2026-13-45', [])).toBeNull();
    expect(await reports.report('/x', '28/10/2026', [])).toBeNull();
    const today = await reports.report('/x', null, []);
    expect(today).toEqual({ day: '2026-10-28', days: ['2026-10-28'], status: 'not-repo', project: null, branch: null, commits: [], truncated: false });
    // il giorno chiesto compare nel selettore anche senza commit
    expect((await reports.report(null, '2026-10-20', []))!.days).toEqual(['2026-10-28', '2026-10-20']);
  });
});
