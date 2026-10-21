import type { AgentState, SessionState, Snapshot } from '../shared/types';
import { assignSeats, createLayout, type OfficeLayout } from './scene';

export interface Seating {
  /** agentId -> seatId */
  seats: Record<string, string>;
  /** massimo numero di agenti visto: l'ufficio cresce ma non si restringe */
  capacity: number;
}

export interface OfficeModel extends Seating {
  layout: OfficeLayout;
  agents: AgentState[];
  session: SessionState | null;
}

/** Deriva dallo snapshot quanto serve alla scena; `prev` garantisce posti stabili. */
export function officeModel(snapshot: Snapshot | null, prev: Seating): OfficeModel {
  const agents = snapshot?.agents ?? [];
  const capacity = Math.max(prev.capacity, agents.length);
  const layout = createLayout(capacity);
  const seats = assignSeats(prev.seats, agents.map((a) => a.id), layout);
  const sessions = snapshot?.sessions ?? [];
  const session =
    sessions.find((s) => s.active) ?? [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
  return { layout, agents, seats, capacity, session };
}
