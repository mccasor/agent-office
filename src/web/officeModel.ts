import type { AgentState, SessionState, Snapshot } from '../shared/types';
import { assignSeats, assignSpots, createLayout, type OfficeLayout, type Seat } from './scene';

/** id dei personaggi delle sessioni principali (Claude stesso): `boss:<sessionId>` */
export const BOSS_PREFIX = 'boss:';
export const BOSS_NAME = 'Claudio Code';

export interface Seating {
  /** agentId -> seatId (scrivanie dell'openspace) */
  seats: Record<string, string>;
  /** agentId -> posto nell'area relax (solo chi ha finito) */
  lounge: Record<string, string>;
  /** id del boss -> postazione nella stanza del boss */
  bossDesks: Record<string, string>;
  /** massimo numero di agenti visto: l'ufficio cresce ma non si restringe */
  capacity: number;
  /** layout per `capacity`, riusato finché ha posti a sufficienza (stessa identità: niente ricostruzioni) */
  layout?: OfficeLayout;
}

export interface OfficeModel extends Seating {
  layout: OfficeLayout;
  agents: AgentState[];
  session: SessionState | null;
  /** Claude stesso, uno per sessione attiva: nella stanza del boss (oltre le sue postazioni, nell'openspace) */
  bosses: AgentState[];
  /** dove va ciascun attore (subagenti e boss): un posto, oppure null = esce dalla porta */
  targets: Record<string, Seat | null>;
}

const BOSS_SEAT_IDS = createLayout(0).bossSeats.map((s) => s.id);

export const EMPTY_SEATING: Seating = { seats: {}, lounge: {}, bossDesks: {}, capacity: 0 };

const projectOf = (s: SessionState): string | null => s.cwd?.split('/').filter(Boolean).at(-1) ?? null;

/** Una sessione principale vista come un agente: stessi comportamenti, posto nella stanza del boss. */
function bossOf(session: SessionState, named: boolean): AgentState {
  const project = projectOf(session);
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

/** Deriva dallo snapshot quanto serve alla scena; `prev` garantisce posti stabili. */
export function officeModel(snapshot: Snapshot | null, prev: Seating): OfficeModel {
  const agents = snapshot?.agents ?? [];
  const sessions = snapshot?.sessions ?? [];
  const session =
    sessions.find((s) => s.active) ?? [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
  const active = sessions.filter((s) => s.active);
  const bosses = active.map((s) => bossOf(s, active.length > 1));

  // postazioni del boss stabili; chi resta senza (più sessioni che postazioni) lavora nell'openspace
  const bossDesks = assignSpots(prev.bossDesks, bosses.map((b) => b.id), BOSS_SEAT_IDS);
  const deskless = bosses.filter((b) => !(b.id in bossDesks));
  const capacity = Math.max(prev.capacity, agents.length + deskless.length);
  // un layout nuovo a ogni snapshot ricostruirebbe la scena e farebbe ripartire i percorsi di tutti gli attori
  // (la capienza cresce a scatti: finché i posti bastano, createLayout darebbe la stessa pianta)
  const layout = prev.layout && capacity <= prev.layout.seats.length ? prev.layout : createLayout(capacity);
  const workers = [...agents, ...deskless].filter((a) => a.status !== 'done' || prev.seats[a.id]);
  const seats = assignSeats(prev.seats, workers.map((a) => a.id), layout);

  // chi ha finito aspetta in area relax finché lavora un subagente della sua sessione; poi escono tutti insieme
  const busy = new Set(agents.filter((a) => a.status !== 'done').map((a) => a.sessionId));
  const resting = [...agents, ...bosses].filter((a) => a.status === 'done' && busy.has(a.sessionId)).map((a) => a.id);
  const lounge = assignSpots(prev.lounge, resting, layout.lounge.map((s) => s.id));

  const seatById = new Map([...layout.seats, ...layout.lounge, ...layout.bossSeats].map((s) => [s.id, s]));
  const targets: Record<string, Seat | null> = {};
  for (const a of [...agents, ...bosses]) {
    const id = a.status === 'done' ? lounge[a.id] : (bossDesks[a.id] ?? seats[a.id]);
    targets[a.id] = id === undefined ? null : (seatById.get(id) ?? null);
  }
  return { layout, agents, seats, lounge, bossDesks, capacity, session, bosses, targets };
}
