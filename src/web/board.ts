import type { AgentState } from '../shared/types';
import type { CardPlace, TaskCard } from './scene';

/** post-it in "in review" conservati dopo che l'agente è uscito dall'ufficio */
export const MAX_REVIEWED = 12;

export type Board = Record<string, TaskCard>;

/**
 * Allinea i post-it agli agenti dello snapshot: uno per agente (titolo, issue e area aggiornati, posto invariato);
 * i nuovi partono da "to do" (già "in review" se l'agente risulta terminato al primo avvistamento);
 * degli agenti usciti restano solo i post-it in review, i più recenti. Pura; l'ordine delle chiavi = ordine sulla board.
 */
export function syncBoard(prev: Board, agents: AgentState[]): Board {
  const out: Board = {};
  const present = new Set(agents.map((a) => a.id));
  const gone = Object.values(prev).filter((c) => !present.has(c.id) && c.place === 'review');
  for (const c of gone.slice(-MAX_REVIEWED)) out[c.id] = c;
  for (const c of Object.values(prev)) {
    if (!present.has(c.id)) continue;
    const a = agents.find((x) => x.id === c.id)!;
    out[c.id] = { ...c, title: a.name, issues: a.issues, area: a.area };
  }
  for (const a of agents) {
    if (a.id in out) continue;
    out[a.id] = { id: a.id, title: a.name, issues: a.issues, area: a.area, place: a.status === 'done' ? 'review' : 'todo' };
  }
  return out;
}

/** Sposta un post-it; attaccato a una board va in fondo (il più recente). */
export function moveCard(board: Board, id: string, place: CardPlace): Board {
  const card = board[id];
  if (!card || card.place === place) return board;
  const { [id]: _removed, ...rest } = board;
  return { ...rest, [id]: { ...card, place } };
}
