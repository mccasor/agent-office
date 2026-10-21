import type { ReactNode } from 'react';
import type { AgentState } from '../../shared/types';

export interface Cell { x: number; z: number }
export interface Seat { id: string; cell: Cell; /** radianti, verso la scrivania */ facing: number }
export interface OfficeLayout {
  width: number;
  depth: number;
  door: Cell;
  seats: Seat[];
  /** walkable[z][x] */
  walkable: boolean[][];
}

/** Openspace a isole di scrivanie; cresce per contenere almeno minSeats posti. Deterministico. */
export function createLayout(_minSeats: number): OfficeLayout {
  throw new Error('not implemented');
}

/** A* su griglia 4-direzioni; [] se irraggiungibile. Include from e to. */
export function findPath(_layout: OfficeLayout, _from: Cell, _to: Cell): Cell[] {
  throw new Error('not implemented');
}

/** agentId -> seatId. Stabile: chi ha già un posto lo mantiene; i nuovi prendono il primo libero più vicino alla porta. */
export function assignSeats(_prev: Record<string, string>, _agentIds: string[], _layout: OfficeLayout): Record<string, string> {
  throw new Error('not implemented');
}

export interface Motion { walking: boolean; seated: boolean }

/** Pavimento, pareti, porta d'ingresso, scrivanie, sedie. */
export function Office(_props: { layout: OfficeLayout }): ReactNode {
  return null;
}

/** Muove i children dalla porta al posto (status entering/working/idle) e verso la porta (done). */
export function AgentActor(_props: {
  agent: AgentState;
  layout: OfficeLayout;
  seatId: string;
  children: (motion: Motion) => ReactNode;
}): ReactNode {
  return null;
}
