import { useRef, useState, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { cellToWorld, type Cell, type OfficeLayout, type Seat } from './layout';
import { findPath } from './path';
import { advanceAlongPath, WALK_SPEED } from './motion';

export interface Motion {
  walking: boolean;
  seated: boolean;
  /** id del posto raggiunto (scrivania, 'boss' o divano 'lounge-N'); null mentre cammina */
  seatId: string | null;
}

type Phase = 'init' | 'walkingIn' | 'seated' | 'walkingOut' | 'gone';

interface Sim {
  /** obiettivo corrente: 'out' oppure 'in:<seatId>' */
  key: string | null;
  layout: OfficeLayout | null;
  path: Cell[];
  dist: number;
  phase: Phase;
  pos: Cell;
  heading: number;
}

const TURN_SPEED = 10; // rad/s (smorzamento esponenziale)

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
  walking: phase === 'walkingIn' || phase === 'walkingOut',
  seated: phase === 'seated',
  seatId: phase === 'seated' ? seatId : null,
});

/**
 * Muove i children dalla porta (o da dove si trovano) al posto `target` e, con target null, verso la porta;
 * poi li nasconde. Posizione/rotazione aggiornate in useFrame via ref; stato React solo alle transizioni di fase.
 */
export function AgentActor({
  layout,
  target,
  children,
}: {
  layout: OfficeLayout;
  target: Seat | null;
  children: (motion: Motion) => ReactNode;
}): ReactNode {
  const group = useRef<Group>(null);
  const sim = useRef<Sim>({ key: null, layout: null, path: [], dist: 0, phase: 'init', pos: layout.door, heading: Math.PI });
  const [phase, setPhase] = useState<Phase>('init');
  const [seatedAt, setSeatedAt] = useState<string | null>(null);

  useFrame((_, delta) => {
    const s = sim.current;
    const g = group.current;
    if (!g) return;
    const seat = target;
    const leaving = !seat;
    const key = seat ? `in:${seat.id}` : 'out';

    if (s.key !== key || s.layout !== layout) {
      const fresh = s.key === null || s.phase === 'gone';
      if (leaving) {
        s.path = fresh ? [] : planFrom(layout, s.pos, layout.door);
      } else {
        s.path = fresh ? findPath(layout, layout.door, seat.cell) : planFrom(layout, s.pos, seat.cell);
        if (s.path.length === 0) s.path = [seat.cell]; // irraggiungibile: compare seduto
      }
      s.dist = 0;
      s.key = key;
      s.layout = layout;
    }

    s.dist += Math.min(delta, 0.1) * WALK_SPEED;
    const r = advanceAlongPath(s.path, s.dist);
    const next: Phase = leaving ? (r.done ? 'gone' : 'walkingOut') : r.done ? 'seated' : 'walkingIn';
    s.pos = { x: r.x, z: r.z };

    const aim = next === 'seated' && seat ? seat.facing : r.direction;
    s.heading = s.phase === 'init' || s.phase === 'gone' ? aim : lerpAngle(s.heading, aim, 1 - Math.exp(-TURN_SPEED * delta));
    const [wx, , wz] = cellToWorld(layout, s.pos);
    g.position.set(wx, 0, wz);
    g.rotation.y = s.heading;
    g.visible = next !== 'gone';

    if (next !== s.phase || (next === 'seated' && seat && seat.id !== seatedAt)) {
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
