import { useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  DoubleSide,
  MathUtils,
  MeshStandardMaterial,
  SphereGeometry,
  type BufferGeometry,
  type Group,
  type Mesh,
} from 'three';
import type { CharacterPreset } from './presets';
import { HIP_Y, SEATED_HIP_Y, SEATED_SHIN_SCALE } from './dimensions';

/*
 * Proporzioni (unità mondo, origine ai piedi, faccia verso +z):
 * gambe 0..0.42 (coscia 0.2 + stinco/scarpa 0.22), busto 0.41..0.79, testa centro 0.9 r 0.2 => alto ~1.1.
 * Seduto: cosce in avanti appoggiate sulla seduta, stinchi verticali allungati fino al pavimento (vedi ./dimensions).
 */
const HALF_PI = Math.PI / 2;

const SHOE_COLOR = '#2b2b2b';
const EYE_COLOR = '#1c1c1c';
const GEAR_COLOR = '#2d2f36';
const LENS_COLOR = '#dceefb';
const TIE_COLOR = '#9b2226';

type GeometryKey =
  | 'head' | 'eye' | 'torso' | 'arm' | 'hand' | 'thigh' | 'shin' | 'shoe'
  | 'hairCap' | 'hairBack' | 'bun' | 'visor' | 'lens' | 'bridge' | 'band' | 'earcup' | 'tie' | 'knot';

let geometries: Record<GeometryKey, BufferGeometry> | null = null;

/** Geometrie condivise da tutti i personaggi (create alla prima istanza). */
function sharedGeometries(): Record<GeometryKey, BufferGeometry> {
  geometries ??= {
    head: new SphereGeometry(0.2, 8, 6),
    eye: new BoxGeometry(0.035, 0.05, 0.02),
    torso: new BoxGeometry(0.42, 0.38, 0.26),
    arm: new CapsuleGeometry(0.06, 0.18, 2, 6),
    hand: new SphereGeometry(0.055, 6, 4),
    thigh: new BoxGeometry(0.15, 0.22, 0.17),
    shin: new BoxGeometry(0.14, 0.16, 0.15),
    shoe: new BoxGeometry(0.15, 0.06, 0.22),
    hairCap: new SphereGeometry(0.215, 8, 4, 0, Math.PI * 2, 0, HALF_PI),
    hairBack: new BoxGeometry(0.38, 0.3, 0.1),
    bun: new SphereGeometry(0.085, 6, 4),
    visor: new BoxGeometry(0.26, 0.025, 0.14),
    lens: new BoxGeometry(0.1, 0.07, 0.015),
    bridge: new BoxGeometry(0.06, 0.015, 0.015),
    band: new CylinderGeometry(0.228, 0.228, 0.045, 10, 1, true, HALF_PI, Math.PI),
    earcup: new CylinderGeometry(0.07, 0.07, 0.05, 8),
    tie: new BoxGeometry(0.06, 0.2, 0.02),
    knot: new BoxGeometry(0.07, 0.05, 0.03),
  };
  return geometries;
}

const materialCache = new Map<string, MeshStandardMaterial>();

/** Un materiale per colore, condiviso tra personaggi con lo stesso preset/colore. */
function material(color: string, doubleSide = false): MeshStandardMaterial {
  const key = `${color}|${doubleSide ? 'd' : 's'}`;
  let m = materialCache.get(key);
  if (!m) {
    m = new MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, side: doubleSide ? DoubleSide : undefined });
    materialCache.set(key, m);
  }
  return m;
}

/** Fase deterministica per id, così personaggi diversi non si muovono all'unisono. */
function phaseOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 159.15;
}

interface Rig {
  body: Group | null;
  torso: Mesh | null;
  head: Group | null;
  armL: Group | null;
  armR: Group | null;
  hipL: Group | null;
  hipR: Group | null;
  kneeL: Group | null;
  kneeR: Group | null;
}

/** Personaggio low-poly procedurale (solo primitive three.js), animato via useFrame. */
export function Character({ preset, walking, seated }: { preset: CharacterPreset; walking: boolean; seated: boolean }): ReactNode {
  const g = useMemo(() => sharedGeometries(), []);
  const m = useMemo(
    () => ({
      skin: material(preset.skin),
      hair: material(preset.hair),
      shirt: material(preset.shirt),
      pants: material(preset.pants),
      shoe: material(SHOE_COLOR),
      eye: material(EYE_COLOR),
      gear: material(GEAR_COLOR, true),
      lens: material(LENS_COLOR),
      tie: material(TIE_COLOR),
    }),
    [preset],
  );
  const phase = useMemo(() => phaseOf(preset.id), [preset.id]);
  const rig = useRef<Rig>({ body: null, torso: null, head: null, armL: null, armR: null, hipL: null, hipR: null, kneeL: null, kneeR: null });

  useFrame((state, delta) => {
    const r = rig.current;
    if (!r.body || !r.torso || !r.head || !r.armL || !r.armR || !r.hipL || !r.hipR || !r.kneeL || !r.kneeR) return;
    const t = state.clock.elapsedTime + phase;
    const dt = Math.min(delta, 0.1);
    const k = 12;
    const damp = (v: number, target: number) => MathUtils.damp(v, target, k, dt);

    let hipL = 0, hipR = 0, kneeL = 0, kneeR = 0, armL: number, armR: number;
    let bodyY = 0, bodyZ = 0, lean = 0, breath = 0;

    if (seated) {
      hipL = hipR = -HALF_PI;
      kneeL = kneeR = HALF_PI;
      bodyY = SEATED_HIP_Y - HIP_Y;
      bodyZ = -0.1;
      lean = 0.08;
      // digitazione: braccia avanti, micro-oscillazioni sfasate
      armL = -1.25 + Math.sin(t * 17) * 0.06;
      armR = -1.25 + Math.sin(t * 19 + 1.3) * 0.06;
      breath = Math.sin(t * 2) * 0.01;
    } else if (walking) {
      const s = Math.sin(t * 9);
      hipL = s * 0.6;
      hipR = -s * 0.6;
      kneeL = Math.max(0, -s) * 0.7;
      kneeR = Math.max(0, s) * 0.7;
      armL = -s * 0.5;
      armR = s * 0.5;
      bodyY = Math.abs(Math.cos(t * 9)) * 0.03;
      lean = 0.05;
    } else {
      breath = Math.sin(t * 2) * 0.015;
      armL = Math.sin(t * 2) * 0.03;
      armR = -armL;
    }

    r.hipL.rotation.x = damp(r.hipL.rotation.x, hipL);
    r.hipR.rotation.x = damp(r.hipR.rotation.x, hipR);
    r.kneeL.rotation.x = damp(r.kneeL.rotation.x, kneeL);
    r.kneeR.rotation.x = damp(r.kneeR.rotation.x, kneeR);
    const shin = damp(r.kneeL.scale.y, seated ? SEATED_SHIN_SCALE : 1);
    r.kneeL.scale.y = r.kneeR.scale.y = shin;
    r.armL.rotation.x = damp(r.armL.rotation.x, armL);
    r.armR.rotation.x = damp(r.armR.rotation.x, armR);
    r.body.position.y = walking && !seated ? bodyY : damp(r.body.position.y, bodyY);
    r.body.position.z = damp(r.body.position.z, bodyZ);
    r.body.rotation.x = damp(r.body.rotation.x, lean);
    r.torso.scale.set(1 + breath * 0.5, 1 + breath, 1 + breath * 0.5);
    r.head.position.y = 0.9 + breath * 0.25;
  });

  const leg = (side: 1 | -1) => (
    <group
      position={[0.1 * side, HIP_Y, 0]}
      ref={(o) => { rig.current[side === 1 ? 'hipR' : 'hipL'] = o; }}
    >
      <mesh geometry={g.thigh} material={m.pants} position={[0, -0.1, 0]} castShadow />
      <group position={[0, -0.2, 0]} ref={(o) => { rig.current[side === 1 ? 'kneeR' : 'kneeL'] = o; }}>
        <mesh geometry={g.shin} material={m.pants} position={[0, -0.08, 0]} castShadow />
        <mesh geometry={g.shoe} material={m.shoe} position={[0, -0.19, 0.03]} castShadow />
      </group>
    </group>
  );

  const arm = (side: 1 | -1) => (
    <group
      position={[0.27 * side, 0.74, 0]}
      rotation={[0, 0, 0.08 * side]}
      ref={(o) => { rig.current[side === 1 ? 'armR' : 'armL'] = o; }}
    >
      <mesh geometry={g.arm} material={m.shirt} position={[0, -0.13, 0]} castShadow />
      <mesh geometry={g.hand} material={m.skin} position={[0, -0.28, 0]} />
    </group>
  );

  return (
    <group>
      <group ref={(o) => { rig.current.body = o; }}>
        {leg(-1)}
        {leg(1)}
        <mesh ref={(o) => { rig.current.torso = o; }} geometry={g.torso} material={m.shirt} position={[0, 0.6, 0]} castShadow />
        {preset.accessory === 'tie' && (
          <>
            <mesh geometry={g.knot} material={m.tie} position={[0, 0.755, 0.135]} />
            <mesh geometry={g.tie} material={m.tie} position={[0, 0.63, 0.135]} />
          </>
        )}
        {arm(-1)}
        {arm(1)}
        <group ref={(o) => { rig.current.head = o; }} position={[0, 0.9, 0]}>
          <mesh geometry={g.head} material={m.skin} castShadow />
          <mesh geometry={g.eye} material={m.eye} position={[-0.07, -0.01, 0.19]} />
          <mesh geometry={g.eye} material={m.eye} position={[0.07, -0.01, 0.19]} />
          <Hair preset={preset} g={g} hair={m.hair} hat={m.shirt} />
          {preset.accessory === 'glasses' && (
            <>
              <mesh geometry={g.lens} material={m.lens} position={[-0.075, -0.01, 0.185]} />
              <mesh geometry={g.lens} material={m.lens} position={[0.075, -0.01, 0.185]} />
              <mesh geometry={g.bridge} material={m.gear} position={[0, 0.005, 0.2]} />
            </>
          )}
          {preset.accessory === 'headphones' && (
            <>
              <mesh geometry={g.band} material={m.gear} rotation={[HALF_PI, 0, 0]} />
              <mesh geometry={g.earcup} material={m.gear} position={[-0.2, -0.02, 0]} rotation={[0, 0, HALF_PI]} />
              <mesh geometry={g.earcup} material={m.gear} position={[0.2, -0.02, 0]} rotation={[0, 0, HALF_PI]} />
            </>
          )}
        </group>
      </group>
    </group>
  );
}

function Hair({ preset, g, hair, hat }: {
  preset: CharacterPreset;
  g: Record<GeometryKey, BufferGeometry>;
  hair: MeshStandardMaterial;
  hat: MeshStandardMaterial;
}): ReactNode {
  switch (preset.hairStyle) {
    case 'bald':
      return null;
    case 'cap':
      return (
        <>
          <mesh geometry={g.hairCap} material={hat} rotation={[-0.15, 0, 0]} scale={[1.02, 0.9, 1.02]} castShadow />
          <mesh geometry={g.visor} material={hat} position={[0, 0.03, 0.22]} rotation={[0.1, 0, 0]} />
        </>
      );
    case 'short':
      return <mesh geometry={g.hairCap} material={hair} rotation={[-0.3, 0, 0]} castShadow />;
    case 'long':
      return (
        <>
          <mesh geometry={g.hairCap} material={hair} rotation={[-0.3, 0, 0]} castShadow />
          <mesh geometry={g.hairBack} material={hair} position={[0, -0.08, -0.13]} castShadow />
        </>
      );
    case 'bun':
      return (
        <>
          <mesh geometry={g.hairCap} material={hair} rotation={[-0.3, 0, 0]} castShadow />
          <mesh geometry={g.bun} material={hair} position={[0, 0.17, -0.12]} castShadow />
        </>
      );
  }
}
