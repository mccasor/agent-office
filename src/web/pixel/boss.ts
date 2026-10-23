import type { AgentState, SessionState } from '../../shared/types';

/** id dei personaggi delle sessioni principali (Claude stesso): `boss:<sessionId>` */
export const BOSS_PREFIX = 'boss:';
export const BOSS_NAME = 'Claudio Code';

/** Una sessione principale vista come un agente: stessi comportamenti, posto alla scrivania del boss. */
export function bossOf(session: SessionState, named: boolean): AgentState {
  const { project } = session;
  return {
    id: `${BOSS_PREFIX}${session.id}`,
    sessionId: session.id,
    // con più sessioni il progetto distingue un Claudio dall'altro
    name: named && project ? `${BOSS_NAME} · ${project}` : BOSS_NAME,
    agentType: 'main',
    description: session.title ?? '',
    area: 'architecture',
    status: session.status,
    model: session.model,
    tokens: session.tokensUsed,
    progress: null,
    issues: session.issues,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
  };
}
