import { describe, expect, it } from 'vitest';
import type { GitCommit } from '../../shared/types';
import { authorColors, byHour, byType, extOf, summarize, topFiles } from './gitStats';

const c = (over: Partial<GitCommit>): GitCommit => ({
  hash: 'h', at: new Date(2026, 9, 28, 10).getTime(), branch: 'main', message: 'm', added: 0, removed: 0, files: [], filesCount: 0,
  author: { kind: 'claude' }, ...over,
});
const agent = (id: string) => ({ kind: 'agent' as const, agentId: id, nickname: `N${id}`, agentType: 'Explore' });

describe('conti della scheda Git', () => {
  it('riepilogo: totali, file diversi e autori dal più attivo, fuori da Claude per ultimo', () => {
    const s = summarize([
      c({ added: 5, removed: 1, files: [{ path: 'a.ts', added: 5, removed: 1 }], author: { kind: 'outside' } }),
      c({ added: 2, files: [{ path: 'a.ts', added: 2, removed: 0 }], author: { kind: 'outside' } }),
      c({ added: 1, files: [{ path: 'b.ts', added: 1, removed: 0 }], author: agent('x') }),
      c({ added: 1, author: agent('x') }),
      c({ added: 1 }),
    ]);
    expect(s).toMatchObject({ commits: 5, added: 10, removed: 1, files: 2 });
    expect(s.authors.map((a) => [a.label, a.count])).toEqual([['Nx', 2], ['Claude', 1], ['Fuori da Claude', 2]]);
  });

  it('colori: Claude nell\'accento, fuori da Claude grigio, agenti stabili dal più vecchio', () => {
    const colors = authorColors([c({ author: agent('new') }), c({ author: agent('old') })]);
    expect(colors.get('claude')).toBe('var(--hud-accent)');
    expect(colors.get('outside')).toBe('var(--hud-muted)');
    expect(colors.get('agent:old')).toBe('var(--area-frontend)');
    expect(colors.get('agent:new')).toBe('var(--area-architecture)');
  });

  it('file più toccati per numero di commit, poi per righe', () => {
    const files = topFiles([
      c({ files: [{ path: 'src/a.ts', added: 1, removed: 0 }, { path: 'src/b.ts', added: 50, removed: 0 }] }),
      c({ files: [{ path: 'src/a.ts', added: 1, removed: 1 }, { path: 'c.ts', added: 60, removed: 0 }] }),
    ], 2);
    expect(files).toEqual([
      { path: 'src/a.ts', name: 'a.ts', commits: 2, added: 2, removed: 1 },
      { path: 'c.ts', name: 'c.ts', commits: 1, added: 60, removed: 0 },
    ]);
  });

  it('righe per ora (ora locale)', () => {
    const hours = byHour([c({ added: 3, removed: 1 }), c({ at: new Date(2026, 9, 28, 10, 59).getTime(), added: 1 }), c({ at: new Date(2026, 9, 28, 23).getTime(), removed: 4 })]);
    expect(hours).toHaveLength(24);
    expect(hours[10]).toEqual({ added: 4, removed: 1, commits: 2 });
    expect(hours[23]).toEqual({ added: 0, removed: 4, commits: 1 });
    expect(hours[0]).toEqual({ added: 0, removed: 0, commits: 0 });
  });

  it('tipi di file per estensione, dalle più righe', () => {
    expect(extOf('src/a.TS')).toBe('.ts');
    expect(extOf('.gitignore')).toBe('');
    expect(extOf('Makefile')).toBe('');
    expect(extOf('dir.v2/file')).toBe('');
    const types = byType([c({ files: [{ path: 'a.ts', added: 1, removed: 0 }, { path: 'b.css', added: 10, removed: 2 }, { path: 'logo.png', added: 0, removed: 0, binary: true }] })]);
    expect(types.map((x) => [x.ext, x.files, x.added, x.removed])).toEqual([['.css', 1, 10, 2], ['.ts', 1, 1, 0], ['.png', 1, 0, 0]]);
  });
});
