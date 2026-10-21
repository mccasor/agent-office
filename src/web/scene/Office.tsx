import { useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
import { cellToWorld, deskCells, plantCells, type OfficeLayout } from './layout';
import { SEAT_HEIGHT } from '../characters/dimensions';

const WALL_H = 0.55;
const WALL_T = 0.3;

const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, flatShading: true, ...extra });

/** Materiali e geometrie condivisi (low-poly, flat). */
const M = {
  floor: mat('#e9e4da'),
  rug: mat('#d5dde3'),
  wall: mat('#f6f3ee'),
  wallTop: mat('#c9c1b4'),
  door: mat('#f2a541', { emissive: '#f2a541', emissiveIntensity: 0.35 }),
  doorFrame: mat('#8a5a2b'),
  deskTop: mat('#d9b98c'),
  deskLeg: mat('#6b6f76'),
  monitor: mat('#2b2f36'),
  screen: mat('#7fc8f8', { emissive: '#4aa3df', emissiveIntensity: 0.6 }),
  chair: mat('#3d5a80'),
  chairBase: mat('#2b2f36'),
  pot: mat('#b5651d'),
  leaf: mat('#4f9d69'),
  leafDark: mat('#3b7d52'),
};

const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
  pot: new THREE.CylinderGeometry(0.2, 0.15, 0.35, 8),
  leaf: new THREE.IcosahedronGeometry(0.32, 0),
};

/** Pavimento, pareti basse, porta d'ingresso, scrivanie con monitor, sedie, piante, luci. */
export function Office({ layout }: { layout: OfficeLayout }): ReactNode {
  const desks = useMemo(() => deskCells(layout), [layout]);
  const plants = useMemo(() => plantCells(layout), [layout]);
  const walls = useMemo(() => wallSegments(layout), [layout]);
  const { width: w, depth: d } = layout;
  const span = Math.max(w, d);

  return (
    <group>
      <hemisphereLight args={['#fffaf0', '#b8b0a2', 1.1]} />
      <directionalLight
        position={[span * 0.35, span * 0.9, span * 0.5]}
        intensity={1.4}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0005}
        shadow-radius={4}
        shadow-camera-left={-span * 0.75}
        shadow-camera-right={span * 0.75}
        shadow-camera-top={span * 0.75}
        shadow-camera-bottom={-span * 0.75}
        shadow-camera-near={0.5}
        shadow-camera-far={span * 3}
      />

      <mesh geometry={G.box} material={M.floor} position={[0, -0.05, 0]} scale={[w, 0.1, d]} receiveShadow />
      <mesh geometry={G.box} material={M.rug} position={[0, 0.005, -1.5]} scale={[w - 4, 0.01, d - 5]} receiveShadow />

      {walls.map((s, i) => (
        <group key={i} position={s.position}>
          <mesh geometry={G.box} material={M.wall} position={[0, WALL_H / 2, 0]} scale={[s.size[0], WALL_H, s.size[1]]} castShadow receiveShadow />
          <mesh geometry={G.box} material={M.wallTop} position={[0, WALL_H + 0.01, 0]} scale={[s.size[0] + 0.02, 0.02, s.size[1] + 0.02]} />
        </group>
      ))}

      <Door layout={layout} />

      {desks.map((desk) => (
        <group key={desk.seatId} position={cellToWorld(layout, desk.cell)} rotation-y={desk.facing}>
          <DeskModel />
        </group>
      ))}
      {layout.seats.map((s) => (
        <group key={s.id} position={cellToWorld(layout, s.cell)} rotation-y={s.facing}>
          <ChairModel />
        </group>
      ))}
      {plants.map((p, i) => (
        <group key={i} position={cellToWorld(layout, p)} rotation-y={i * 1.3}>
          <PlantModel />
        </group>
      ))}
    </group>
  );
}

interface WallSegment { position: [number, number, number]; size: [number, number] }

/** Pareti sulle celle perimetrali (spessore WALL_T al centro della cella), parete sud interrotta dalla porta. */
function wallSegments(layout: OfficeLayout): WallSegment[] {
  const [xW, , zN] = cellToWorld(layout, { x: 0, z: 0 });
  const [xE, , zS] = cellToWorld(layout, { x: layout.width - 1, z: layout.depth - 1 });
  const [xd] = cellToWorld(layout, layout.door);
  const h = WALL_T / 2;
  const along = (x0: number, x1: number, z: number): WallSegment => ({ position: [(x0 + x1) / 2, 0, z], size: [x1 - x0, WALL_T] });
  return [
    along(xW - h, xE + h, zN),
    along(xW - h, xd - 0.5, zS),
    along(xd + 0.5, xE + h, zS),
    { position: [xW, 0, (zN + zS) / 2], size: [WALL_T, zS - zN + WALL_T] },
    { position: [xE, 0, (zN + zS) / 2], size: [WALL_T, zS - zN + WALL_T] },
  ];
}

function Door({ layout }: { layout: OfficeLayout }): ReactNode {
  const [x, , z] = cellToWorld(layout, layout.door);
  return (
    <group position={[x, 0, z]}>
      <mesh geometry={G.box} material={M.door} position={[0, 0.01, -0.5]} scale={[0.9, 0.02, 1.9]} receiveShadow />
      {[-0.5, 0.5].map((dx) => (
        <mesh key={dx} geometry={G.box} material={M.doorFrame} position={[dx, (WALL_H + 0.25) / 2, 0]} scale={[0.12, WALL_H + 0.25, WALL_T + 0.1]} castShadow />
      ))}
    </group>
  );
}

/** Scrivania: local +z verso il posto; monitor sul lato opposto, schermo rivolto al posto. */
function DeskModel(): ReactNode {
  return (
    <group>
      <mesh geometry={G.box} material={M.deskTop} position={[0, 0.72, 0]} scale={[0.96, 0.05, 0.96]} castShadow receiveShadow />
      <mesh geometry={G.box} material={M.deskLeg} position={[-0.44, 0.35, 0]} scale={[0.05, 0.7, 0.85]} castShadow />
      <mesh geometry={G.box} material={M.deskLeg} position={[0.44, 0.35, 0]} scale={[0.05, 0.7, 0.85]} castShadow />
      <group position={[0, 0.745, -0.22]}>
        <mesh geometry={G.box} material={M.monitor} position={[0, 0.01, 0]} scale={[0.22, 0.02, 0.14]} />
        <mesh geometry={G.box} material={M.monitor} position={[0, 0.1, 0]} scale={[0.04, 0.18, 0.04]} />
        <mesh geometry={G.box} material={M.monitor} position={[0, 0.3, 0]} scale={[0.6, 0.36, 0.04]} castShadow />
        <mesh geometry={G.box} material={M.screen} position={[0, 0.3, 0.022]} scale={[0.54, 0.3, 0.005]} />
      </group>
      <mesh geometry={G.box} material={M.monitor} position={[0, 0.755, 0.12]} scale={[0.4, 0.015, 0.13]} />
    </group>
  );
}

const SEAT_T = 0.08;

/** Sedia: local +z verso la scrivania, schienale dietro; piano seduta a SEAT_HEIGHT (condiviso col personaggio). */
function ChairModel(): ReactNode {
  return (
    <group position={[0, 0, -0.08]}>
      <mesh geometry={G.cyl} material={M.chairBase} position={[0, 0.02, 0]} scale={[0.4, 0.04, 0.4]} />
      <mesh geometry={G.cyl} material={M.chairBase} position={[0, (SEAT_HEIGHT - SEAT_T) / 2, 0]} scale={[0.06, SEAT_HEIGHT - SEAT_T, 0.06]} />
      <mesh geometry={G.box} material={M.chair} position={[0, SEAT_HEIGHT - SEAT_T / 2, 0]} scale={[0.46, SEAT_T, 0.44]} castShadow receiveShadow />
      <mesh geometry={G.box} material={M.chair} position={[0, SEAT_HEIGHT + 0.24, -0.21]} scale={[0.44, 0.5, 0.07]} castShadow />
    </group>
  );
}

function PlantModel(): ReactNode {
  return (
    <group>
      <mesh geometry={G.pot} material={M.pot} position={[0, 0.175, 0]} castShadow receiveShadow />
      <mesh geometry={G.leaf} material={M.leaf} position={[0, 0.6, 0]} scale={[1, 1.15, 1]} castShadow />
      <mesh geometry={G.leaf} material={M.leafDark} position={[0.12, 0.85, 0.05]} scale={0.6} castShadow />
      <mesh geometry={G.leaf} material={M.leafDark} position={[-0.1, 0.78, -0.08]} scale={0.55} castShadow />
    </group>
  );
}
