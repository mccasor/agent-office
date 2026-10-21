import type { AgentState, SessionState, Snapshot } from '../shared/types';
import { assignSeats, assignSpots, createLayout, type OfficeLayout, type Seat } from './scene';

export const BOSS_ID = 'boss';
export const BOSS_NAME = 'Claudio Code';

export interface Seating {
  /** agentId -> seatId */
  seats: Record<string, string>;
  /** agentId -> posto sui divani dell'area relax (solo chi ha finito) */
  lounge: Record<string, string>;
  /** massimo numero di agenti visto: l'ufficio cresce ma non si restringe */
  capacity: number;
}

export interface OfficeModel extends Seating {
  layout: OfficeLayout;
  agents: AgentState[];
  session: SessionState | null;
  /** Claude stesso (sessione principale), nella stanza del boss; null se la sessione non è attiva */
  boss: AgentState | null;
  /** dove va ciascun attore (subagenti e boss): un posto, oppure null = esce dalla porta */
  targets: Record<string, Seat | null>;
}

/** La sessione principale vista come un agente: stessi comportamenti, posto nella stanza del boss. */
function bossOf(session: SessionState | null): AgentState | null {
  if (!session?.active) return null;
  return {
    id: BOSS_ID,
    sessionId: session.id,
    name: BOSS_NAME,
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

/** Deriva dallo snapshot quanto serve alla scena; `prev` garantisce posti stabili. */
export function officeModel(snapshot: Snapshot | null, prev: Seating): OfficeModel {
  const agents = snapshot?.agents ?? [];
  const capacity = Math.max(prev.capacity, agents.length);
  const layout = createLayout(capacity);
  const seats = assignSeats(prev.seats, agents.filter((a) => a.status !== 'done' || prev.seats[a.id]).map((a) => a.id), layout);
  const sessions = snapshot?.sessions ?? [];
  const session =
    sessions.find((s) => s.active) ?? [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
  const boss = bossOf(session);

  // chi ha finito aspetta sui divani finché un altro subagente lavora; poi escono tutti insieme
  const allDone = agents.every((a) => a.status === 'done');
  const resting = allDone ? [] : [...agents, ...(boss ? [boss] : [])].filter((a) => a.status === 'done').map((a) => a.id);
  const lounge = assignSpots(prev.lounge, resting, layout.lounge.map((s) => s.id));

  const seatById = new Map([...layout.seats, ...layout.lounge, layout.bossSeat].map((s) => [s.id, s]));
  const targets: Record<string, Seat | null> = {};
  for (const a of agents) {
    const id = a.status === 'done' ? lounge[a.id] : seats[a.id];
    targets[a.id] = id === undefined ? null : (seatById.get(id) ?? null);
  }
  if (boss) {
    targets[boss.id] = boss.status !== 'done' ? layout.bossSeat : (seatById.get(lounge[boss.id] ?? '') ?? null);
  }
  return { layout, agents, seats, lounge, capacity, session, boss, targets };
}
