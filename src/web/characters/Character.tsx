import { useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  MathUtils,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
  type Group,
} from 'three';
import type { CharacterPreset } from './presets';
import { HIP_Y, SEATED_HIP_Y, SEATED_SHIN_SCALE, THIGH_THICKNESS } from './dimensions';
import { CoffeeCup } from './CoffeeCup';

/*
 * Stile "clay"/giocattolo: testa a uovo grande, occhi sporgenti con palpebre pesanti, naso a salsicciotto,
 * labbra a ciambella e barba piena sulla metà inferiore; corpo a fagiolo, arti a capsula, tutto liscio e opaco.
 * Proporzioni (unità mondo, origine ai piedi, faccia verso +z):
 * gambe 0..0.42 (coscia 0.2 + stinco/scarpa 0.22), busto 0.37..0.83, testa centro 0.94 (semiasse verticale 0.24) => alto ~1.18.
 * Seduto: cosce in avanti appoggiate sulla seduta, stinchi verticali allungati fino al pavimento (vedi ./dimensions).
 */
const HALF_PI = Math.PI / 2;
const HEAD_Y = 0.94;
/** raggio base del cranio; la scala SKULL lo rende un uovo un po' più alto che largo */
const SKULL_R = 0.22;
const SKULL: [number, number, number] = [0.9, 1.08, 0.92];

const SHOULDER_X = 0.22;
const SHOULDER_Y = 0.72;
/** inclinazione laterale delle braccia (verso l'esterno) */
const ARM_SPLAY = 0.08;
/** spalla → centro mano lungo il braccio */
const HAND_DIST = 0.27;

/** braccio destro piegato in avanti per reggere la tazza */
const HOLD_ARM = -0.9;
/** braccio sinistro alzato verso la board */
const REACH_ARM = -2.3;
/** braccia appoggiate sulle gambe da seduto, senza digitare */
const REST_ARM = -0.45;

/** Centro della mano con il braccio ruotato di `pitch` (Euler XYZ: prima lo splay su z, poi il pitch su x). */
function handAt(side: 1 | -1, pitch: number): [number, number, number] {
  const sx = HAND_DIST * Math.sin(ARM_SPLAY) * side;
  const sy = -HAND_DIST * Math.cos(ARM_SPLAY);
  return [SHOULDER_X * side + sx, SHOULDER_Y + sy * Math.cos(pitch), sy * Math.sin(pitch)];
}
const RIGHT_HAND = handAt(1, HOLD_ARM);
const LEFT_HAND = handAt(-1, HOLD_ARM);
/** fondo della tazza: appena sotto il centro della mano destra, un po' avanti (la mano la cinge di lato) */
const CUP_IN_HAND: [number, number, number] = [RIGHT_HAND[0], RIGHT_HAND[1] - 0.05, RIGHT_HAND[2] + 0.03];
/** stessa presa, mano sinistra (post-it) */
const LEFT_IN_HAND: [number, number, number] = [LEFT_HAND[0], LEFT_HAND[1] + 0.035, LEFT_HAND[2] + 0.05];

const SHOE_COLOR = '#2e2a2f';
const PUPIL_COLOR = '#151217';
const EYE_WHITE = '#f6f3ee';
const MOUTH_COLOR = '#2a0f17';
const GEAR_COLOR = '#2d2f36';
const TIE_COLOR = '#9b2226';

type GeometryKey =
  | 'skull' | 'beard' | 'ear' | 'eye' | 'pupil' | 'lidTop' | 'lidLow' | 'nose' | 'lips' | 'mouth'
  | 'torso' | 'pantsTop' | 'arm' | 'hand' | 'thigh' | 'shin' | 'shoe'
  | 'hairCap' | 'hairBack' | 'bun' | 'hatCap' | 'visor' | 'rim' | 'bridge' | 'band' | 'earcup' | 'tie' | 'knot';

let geometries: Record<GeometryKey, BufferGeometry> | null = null;

/** Geometrie condivise da tutti i personaggi (create alla prima istanza), con segmenti sufficienti per lo smooth shading. */
function sharedGeometries(): Record<GeometryKey, BufferGeometry> {
  geometries ??= {
    skull: new SphereGeometry(SKULL_R, 32, 24),
    // calotta inferiore leggermente più grande del cranio: la barba ha uno spessore visibile sul bordo
    beard: new SphereGeometry(SKULL_R * 1.045, 32, 14, 0, Math.PI * 2, HALF_PI - 0.06, HALF_PI + 0.06),
    ear: new SphereGeometry(0.05, 16, 12),
    eye: new SphereGeometry(0.05, 24, 16),
    pupil: new SphereGeometry(0.014, 12, 8),
    // palpebra superiore: calotta un po' oltre il polo, inclinata in avanti in scena per coprire metà occhio
    lidTop: new SphereGeometry(0.055, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.4),
    lidLow: new SphereGeometry(0.053, 24, 8, 0, Math.PI * 2, Math.PI * 0.8, Math.PI * 0.2),
    nose: new CapsuleGeometry(0.038, 0.06, 10, 16),
    lips: new TorusGeometry(0.044, 0.021, 14, 32),
    mouth: new SphereGeometry(0.04, 16, 10),
    torso: new CapsuleGeometry(0.16, 0.14, 12, 24),
    pantsTop: new SphereGeometry(0.165, 24, 10, 0, Math.PI * 2, HALF_PI, HALF_PI),
    arm: new CapsuleGeometry(0.05, 0.15, 8, 14),
    hand: new SphereGeometry(0.052, 16, 12),
    thigh: new CapsuleGeometry(THIGH_THICKNESS / 2, 0.2 - THIGH_THICKNESS, 8, 16),
    shin: new CapsuleGeometry(0.068, 0.07, 8, 16),
    shoe: new SphereGeometry(0.075, 18, 12),
    hairCap: new SphereGeometry(SKULL_R * 1.04, 32, 10, 0, Math.PI * 2, 0, Math.PI * 0.4),
    hairBack: new SphereGeometry(SKULL_R * 1.035, 24, 12, Math.PI + 0.35, Math.PI - 0.7, Math.PI * 0.2, Math.PI * 0.55),
    bun: new SphereGeometry(0.075, 16, 12),
    hatCap: new SphereGeometry(SKULL_R * 1.06, 32, 10, 0, Math.PI * 2, 0, Math.PI * 0.45),
    visor: new CylinderGeometry(0.13, 0.13, 0.018, 24, 1, false, -HALF_PI, Math.PI),
    rim: new TorusGeometry(0.064, 0.009, 10, 28),
    bridge: new CapsuleGeometry(0.008, 0.05, 4, 8),
    band: new TorusGeometry(0.225, 0.018, 10, 32, Math.PI),
    earcup: new SphereGeometry(0.062, 18, 12),
    tie: new CapsuleGeometry(0.03, 0.14, 6, 12),
    knot: new SphereGeometry(0.03, 12, 8),
  };
  return geometries;
}

const materialCache = new Map<string, MeshStandardMaterial>();

/** Un materiale opaco per colore, condiviso tra personaggi con lo stesso preset/colore. */
function material(color: string, doubleSide = false, roughness = 0.9): MeshStandardMaterial {
  const key = `${color}|${doubleSide ? 'd' : 's'}|${roughness}`;
  let m = materialCache.get(key);
  if (!m) {
    m = new MeshStandardMaterial({ color, roughness, metalness: 0, side: doubleSide ? DoubleSide : undefined });
    materialCache.set(key, m);
  }
  return m;
}

/** Tinta derivata dall'incarnato (naso, labbra): più calda, satura e scura. */
function warmTone(skin: string, dl: number, ds: number): string {
  return `#${new Color(skin).offsetHSL(-0.012, ds, dl).getHexString()}`;
}

/** Fase deterministica per id, così personaggi diversi non si muovono all'unisono. */
function phaseOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 159.15;
}

interface Rig {
  body: Group | null;
  torso: Group | null;
  head: Group | null;
  armL: Group | null;
  armR: Group | null;
  hipL: Group | null;
  hipR: Group | null;
  kneeL: Group | null;
  kneeR: Group | null;
}

type Materials = Record<
  'skin' | 'warm' | 'lips' | 'mouth' | 'eye' | 'pupil' | 'hair' | 'beard' | 'shirt' | 'pants' | 'shoe' | 'gear' | 'tie',
  MeshStandardMaterial
>;

/**
 * Personaggio procedurale in stile clay (solo primitive three.js), animato via useFrame.
 * `holding`: regge la tazza di caffè con la destra; `typing` (default true): da seduto digita, altrimenti si rilassa;
 * `leftHand`: oggetto retto con la sinistra (es. un post-it); `reaching`: alza la sinistra verso la board.
 */
export function Character({
  preset,
  walking,
  seated,
  holding = false,
  typing = true,
  leftHand,
  reaching = false,
}: {
  preset: CharacterPreset;
  walking: boolean;
  seated: boolean;
  holding?: boolean;
  typing?: boolean;
  leftHand?: ReactNode;
  reaching?: boolean;
}): ReactNode {
  const g = useMemo(() => sharedGeometries(), []);
  const m = useMemo<Materials>(
    () => ({
      skin: material(preset.skin),
      warm: material(warmTone(preset.skin, -0.05, 0.06)),
      lips: material(warmTone(preset.skin, -0.08, 0.1), false, 0.75),
      mouth: material(MOUTH_COLOR),
      eye: material(EYE_WHITE, false, 0.55),
      pupil: material(PUPIL_COLOR, false, 0.4),
      hair: material(preset.hair, true),
      beard: material(preset.beard ?? preset.skin, true),
      shirt: material(preset.shirt),
      pants: material(preset.pants, true),
      shoe: material(SHOE_COLOR),
      gear: material(GEAR_COLOR, true, 0.7),
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
    let bodyY = 0, bodyZ = 0, lean = 0, breath = 0, nod = 0;

    if (seated) {
      hipL = hipR = -HALF_PI;
      kneeL = kneeR = HALF_PI;
      bodyY = SEATED_HIP_Y - HIP_Y;
      bodyZ = -0.1;
      lean = 0.08;
      if (typing) {
        // digitazione: braccia avanti, micro-oscillazioni sfasate, testa china sullo schermo
        armL = -1.25 + Math.sin(t * 17) * 0.06;
        armR = -1.25 + Math.sin(t * 19 + 1.3) * 0.06;
        nod = 0.08;
      } else {
        armL = REST_ARM + Math.sin(t * 2) * 0.03;
        armR = REST_ARM;
      }
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
      nod = Math.cos(t * 18) * 0.03;
    } else {
      breath = Math.sin(t * 2) * 0.015;
      armL = Math.sin(t * 2) * 0.03;
      armR = -armL;
    }
    if (holding) armR = HOLD_ARM + Math.sin(t * 2) * 0.02;
    if (reaching) armL = REACH_ARM + Math.sin(t * 6) * 0.08;
    else if (leftHand) armL = HOLD_ARM;

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
    r.head.position.y = HEAD_Y + breath * 0.25;
    r.head.rotation.x = damp(r.head.rotation.x, nod);
  });

  const leg = (side: 1 | -1) => (
    <group
      position={[0.095 * side, HIP_Y, 0]}
      ref={(o) => { rig.current[side === 1 ? 'hipR' : 'hipL'] = o; }}
    >
      <mesh geometry={g.thigh} material={m.pants} position={[0, -0.1, 0]} castShadow />
      <group position={[0, -0.2, 0]} ref={(o) => { rig.current[side === 1 ? 'kneeR' : 'kneeL'] = o; }}>
        <mesh geometry={g.shin} material={m.pants} position={[0, -0.08, 0]} castShadow />
        <mesh geometry={g.shoe} material={m.shoe} position={[0, -0.188, 0.035]} scale={[1, 0.5, 1.35]} castShadow />
      </group>
    </group>
  );

  const arm = (side: 1 | -1) => (
    <group
      position={[SHOULDER_X * side, SHOULDER_Y, 0]}
      rotation={[0, 0, ARM_SPLAY * side]}
      ref={(o) => { rig.current[side === 1 ? 'armR' : 'armL'] = o; }}
    >
      <mesh geometry={g.arm} material={m.shirt} position={[0, -0.12, 0]} castShadow />
      <mesh geometry={g.hand} material={m.skin} position={[0, -HAND_DIST, 0]} castShadow />
    </group>
  );

  return (
    <group>
      <group ref={(o) => { rig.current.body = o; }}>
        {leg(-1)}
        {leg(1)}
        {/* busto a fagiolo: camicia sopra, calotta dei pantaloni sotto */}
        <group ref={(o) => { rig.current.torso = o; }} position={[0, 0.6, 0]} scale={[1.15, 1, 0.9]}>
          <mesh geometry={g.torso} material={m.shirt} castShadow />
          <mesh geometry={g.pantsTop} material={m.pants} position={[0, -0.07, 0]} />
        </group>
        {preset.accessory === 'tie' && (
          <group position={[0, 0, 0.142]} rotation={[-0.12, 0, 0]}>
            <mesh geometry={g.knot} material={m.tie} position={[0, 0.69, 0.005]} scale={[1, 0.9, 0.6]} />
            <mesh geometry={g.tie} material={m.tie} position={[0, 0.57, 0.004]} scale={[1, 1, 0.35]} />
          </group>
        )}
        {arm(-1)}
        {arm(1)}
        {holding && <CoffeeCup position={CUP_IN_HAND} />}
        {leftHand && !reaching && <group position={LEFT_IN_HAND}>{leftHand}</group>}
        <group ref={(o) => { rig.current.head = o; }} position={[0, HEAD_Y, 0]}>
          <Head preset={preset} g={g} m={m} />
        </group>
      </group>
    </group>
  );
}

/** Testa (origine al centro del cranio): uovo, barba sulla metà inferiore, occhi a palpebra pesante, naso, labbra, orecchie. */
function Head({ preset, g, m }: { preset: CharacterPreset; g: Record<GeometryKey, BufferGeometry>; m: Materials }): ReactNode {
  return (
    <>
      <group scale={SKULL}>
        <mesh geometry={g.skull} material={m.skin} castShadow />
        {preset.beard && <mesh geometry={g.beard} material={m.beard} castShadow />}
        <Hair preset={preset} g={g} m={m} />
      </group>
      {([-1, 1] as const).map((s) => (
        <group key={s}>
          <mesh geometry={g.ear} material={m.warm} position={[0.19 * s, 0.025, -0.01]} scale={[0.55, 1, 0.8]} />
          {/* occhio: bulbo bianco schiacciato, pupilla piccola sotto il bordo della palpebra, palpebre del colore della pelle */}
          <group position={[0.08 * s, 0.07, 0.168]} rotation={[0, 0.22 * s, 0]} scale={[1.3, 0.95, 0.9]}>
            <mesh geometry={g.eye} material={m.eye} />
            <mesh geometry={g.pupil} material={m.pupil} position={[-0.004 * s, -0.008, 0.048]} scale={[0.85, 1, 0.6]} />
            <mesh geometry={g.lidTop} material={m.skin} rotation={[0.2, 0, 0]} />
            <mesh geometry={g.lidLow} material={m.warm} rotation={[-0.3, 0, 0]} />
          </group>
        </group>
      ))}
      {/* naso lungo a salsicciotto, con la punta che sporge in avanti */}
      <mesh geometry={g.nose} material={m.warm} position={[0, 0.035, 0.207]} rotation={[-0.32, 0, 0]} scale={[1, 1, 0.95]} />
      {/* bocca aperta scura dentro labbra a ciambella */}
      <mesh geometry={g.mouth} material={m.mouth} position={[0, -0.09, 0.19]} scale={[1.3, 0.32, 0.5]} />
      <mesh geometry={g.lips} material={m.lips} position={[0, -0.09, 0.196]} rotation={[-0.2, 0, 0]} scale={[1.45, 0.62, 1]} />
      {preset.hairStyle === 'cap' && (
        <mesh geometry={g.visor} material={m.shirt} position={[0, 0.125, 0.12]} rotation={[0.12, 0, 0]} />
      )}
      {preset.accessory === 'glasses' && (
        <>
          {([-1, 1] as const).map((s) => (
            <mesh key={s} geometry={g.rim} material={m.gear} position={[0.085 * s, 0.072, 0.215]} rotation={[0, 0.2 * s, 0]} scale={[1.15, 0.95, 1]} />
          ))}
          <mesh geometry={g.bridge} material={m.gear} position={[0, 0.085, 0.235]} rotation={[0, 0, HALF_PI]} />
        </>
      )}
      {preset.accessory === 'headphones' && (
        <>
          <mesh geometry={g.band} material={m.gear} position={[0, 0.02, -0.01]} scale={[0.97, 1.12, 1]} />
          {([-1, 1] as const).map((s) => (
            <mesh key={s} geometry={g.earcup} material={m.gear} position={[0.205 * s, 0.02, -0.01]} scale={[0.55, 1, 0.9]} />
          ))}
        </>
      )}
    </>
  );
}

/** Capelli/cappello, dentro il gruppo scalato del cranio (geometrie su sfera di raggio SKULL_R). */
function Hair({ preset, g, m }: { preset: CharacterPreset; g: Record<GeometryKey, BufferGeometry>; m: Materials }): ReactNode {
  switch (preset.hairStyle) {
    case 'bald':
      return null;
    case 'cap':
      return <mesh geometry={g.hatCap} material={m.shirt} rotation={[-0.12, 0, 0]} castShadow />;
    case 'short':
      return <mesh geometry={g.hairCap} material={m.hair} rotation={[-0.35, 0, 0]} castShadow />;
    case 'long':
      return (
        <>
          <mesh geometry={g.hairCap} material={m.hair} rotation={[-0.3, 0, 0]} castShadow />
          <mesh geometry={g.hairBack} material={m.hair} castShadow />
        </>
      );
    case 'bun':
      return (
        <>
          <mesh geometry={g.hairCap} material={m.hair} rotation={[-0.3, 0, 0]} castShadow />
          <mesh geometry={g.bun} material={m.hair} position={[0, 0.2, -0.11]} castShadow />
        </>
      );
  }
}
