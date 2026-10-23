import { describe, expect, it } from 'vitest';
import type { SessionState } from '../../shared/types';
import { BOSS_NAME, BOSS_PREFIX, bossOf } from './boss';

const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 };
const session = (extra: Partial<SessionState> = {}): SessionState => ({
  id: 's1', title: 'Rifare la pianta', model: 'claude-opus-5-5', effort: null, context: { used: 0, window: null }, tokensUsed: tokens,
  startedAt: 1, updatedAt: 2, active: true, status: 'working', issues: [14], cwd: '/u/alpha', branch: null, waiting: false,
  dot: 'working', project: 'alpha', ...extra,
});

describe('bossOf', () => {
  it('la sessione diventa Claudio Code, con id, stato e dati della sessione', () => {
    expect(bossOf(session(), false)).toMatchObject({
      id: `${BOSS_PREFIX}s1`, sessionId: 's1', name: BOSS_NAME, agentType: 'main', description: 'Rifare la pianta',
      status: 'working', model: 'claude-opus-5-5', issues: [14], startedAt: 1, updatedAt: 2, progress: null,
    });
  });

  it('con più sessioni il nome porta il progetto (se c\'è)', () => {
    expect(bossOf(session(), true).name).toBe('Claudio Code · alpha');
    expect(bossOf(session({ project: null }), true).name).toBe(BOSS_NAME);
    expect(bossOf(session({ title: null }), false).description).toBe('');
  });
});
