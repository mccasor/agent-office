import { useRef, useState, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { cellToWorld, type BoardColumn, type Cell, type OfficeLayout, type Seat } from './layout';
import { findPath } from './path';
import { advanceAlongPath, WALK_SPEED } from './motion';
import type { CardPlace } from './TaskBoard';

export interface Motion {
  walking: boolean;
  seated: boolean;
  /** davanti a una board mentre stacca o attacca il post-it */
  reaching: boolean;
  /** id del posto raggiunto (scrivania 'seat-x-z', 'boss', 'lounge-N' a sedere, 'stand-N' in piedi); null altrimenti */
  seatId: string | null;
}

/** Un passo alla board: staccare il post-it da una colonna o attaccarlo a un'altra. */
export interface CardStep { action: 'pick' | 'drop'; column: BoardColumn }

/**
 * Passi alla board prima di raggiungere la destinazione: chi va alla scrivania porta il proprio post-it in
 * "in progress", chi se ne va (area relax o uscita) lo porta in "in review". Pura.
 */
export function cardSteps(place: CardPlace | null, toDesk: boolean): CardStep[] {
  if (place === null) return [];
  const dest: BoardColumn = toDesk ? 'progress' : 'review';
  if (place === dest) return [];
  const drop: CardStep = { action: 'drop', column: dest };
  return place === 'carry' ? [drop] : [{ action: 'pick', column: place }, drop];
}

const isDesk = (seat: Seat | null): boolean => seat?.id.startsWith('seat-') ?? false;

type Phase = 'init' | 'walking' | 'board' | 'seated' | 'standing' | 'gone';

/** posti in piedi dell'area relax: si arriva e si resta lì col caffè, senza sedersi */
const isStanding = (seat: Seat): boolean => seat.id.startsWith('stand-');

interface Leg { to: Cell; step: CardStep | null }

interface Sim {
  /** obiettivo corrente: 'out' oppure 'in:<seatId>' */
  key: string | null;
  layout: OfficeLayout | null;
  legs: Leg[];
  path: Cell[];
  dist: number;
  /** secondi rimasti davanti alla board */
  wait: number;
  phase: Phase;
  pos: Cell;
  heading: number;
  /** posto del post-it secondo l'attore (aggiornato subito, prima che arrivi il nuovo prop) */
  card: CardPlace | null;
}

const TURN_SPEED = 10; // rad/s (smorzamento esponenziale)
/** secondi davanti alla board per staccare o attaccare il post-it */
export const BOARD_PAUSE = 0.9;

function lerpAngle(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

/** Path dalla posizione corrente (anche frazionaria, su un segmento) alla destinazione. */
function planFrom(layout: OfficeLayout, pos: Cell, to: Cell): Cell[] {
  const start = { x: Math.round(pos.x), z: Math.round(pos.z) };
  const path = findPath(layout, start, to);
  if (path.length === 0) return [];
  return pos.x !== start.x || pos.z !== start.z ? [pos, ...path] : path;
}

const motionOf = (phase: Phase, seatId: string | null): Motion => ({
  walking: phase === 'walking',
  seated: phase === 'seated',
  reaching: phase === 'board',
  seatId: phase === 'seated' || phase === 'standing' ? seatId : null,
});

/**
 * Muove i children dalla porta (o da dove si trovano) al posto `target` e, con target null, verso la porta;
 * poi li nasconde. Lungo la strada passa dalle board per spostare il proprio post-it (`card`, notificato con
 * `onCard`). Posizione/rotazione aggiornate in useFrame via ref; stato React solo alle transizioni di fase.
 */
export function AgentActor({
  layout,
  target,
  card = null,
  onCard,
  children,
}: {
  layout: OfficeLayout;
  target: Seat | null;
  /** posto iniziale del post-it; null = nessun task (es. Claudio Code) */
  card?: CardPlace | null;
  onCard?: (place: CardPlace) => void;
  children: (motion: Motion) => ReactNode;
}): ReactNode {
  const group = useRef<Group>(null);
  const sim = useRef<Sim>({
    key: null, layout: null, legs: [], path: [], dist: 0, wait: 0, phase: 'init', pos: layout.door, heading: Math.PI, card,
  });
  const [phase, setPhase] = useState<Phase>('init');
  const [seatedAt, setSeatedAt] = useState<string | null>(null);

  useFrame((_, delta) => {
    const s = sim.current;
    const g = group.current;
    if (!g) return;
    const seat = target;
    const key = seat ? `in:${seat.id}` : 'out';
    const dt = Math.min(delta, 0.1);

    const startLeg = (from: Cell) => {
      const leg = s.legs[0]!;
      s.path = planFrom(layout, from, leg.to);
      if (s.path.length === 0) s.path = [leg.to]; // irraggiungibile: compare lì
      s.dist = 0;
    };

    if (s.key !== key || s.layout !== layout) {
      const fresh = s.key === null || s.phase === 'gone';
      const steps = cardSteps(s.card, isDesk(seat));
      s.legs = [
        ...steps.map((step) => ({ to: layout.boards[step.column].cell, step })),
        { to: seat?.cell ?? layout.door, step: null },
      ];
      s.wait = 0;
      if (fresh && !seat && steps.length === 0) {
        s.legs = [];
        s.path = [];
      } else {
        startLeg(fresh ? layout.door : s.pos);
      }
      s.key = key;
      s.layout = layout;
    }

    let next: Phase;
    let aim = s.heading;
    if (s.legs.length === 0) {
      next = 'gone';
    } else if (s.wait > 0) {
      // davanti alla board: allo scadere stacca/attacca il post-it e riparte verso la tappa successiva
      next = 'board';
      aim = Math.PI;
      s.wait -= dt;
      if (s.wait <= 0) {
        const { step } = s.legs.shift()!;
        if (step) {
          s.card = step.action === 'pick' ? 'carry' : step.column;
          onCard?.(s.card);
        }
        startLeg(s.pos);
      }
    } else {
      s.dist += dt * WALK_SPEED;
      const r = advanceAlongPath(s.path, s.dist);
      s.pos = { x: r.x, z: r.z };
      aim = r.direction;
      const leg = s.legs[0]!;
      if (!r.done) next = 'walking';
      else if (leg.step) {
        s.wait = BOARD_PAUSE;
        next = 'board';
      } else if (seat) {
        next = isStanding(seat) ? 'standing' : 'seated';
        aim = seat.facing;
      } else {
        next = 'gone';
      }
    }

    s.heading = s.phase === 'init' || s.phase === 'gone' ? aim : lerpAngle(s.heading, aim, 1 - Math.exp(-TURN_SPEED * delta));
    const [wx, , wz] = cellToWorld(layout, s.pos);
    g.position.set(wx, 0, wz);
    g.rotation.y = s.heading;
    g.visible = next !== 'gone';

    if (next !== s.phase || ((next === 'seated' || next === 'standing') && seat && seat.id !== seatedAt)) {
      s.phase = next;
      setPhase(next);
      setSeatedAt(seat?.id ?? null);
    }
  });

  return (
    <group ref={group} visible={false}>
      {phase === 'init' || phase === 'gone' ? null : children(motionOf(phase, seatedAt))}
    </group>
  );
}
