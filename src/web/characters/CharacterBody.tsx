import { useMemo, type ReactNode } from 'react';
import {
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
} from 'three';
import type { CharacterPreset } from './presets';
import { HIP_Y, THIGH_THICKNESS } from './dimensions';
import type { Rig } from './useCharacterRig';

/*
 * Stile "clay"/giocattolo: testa a uovo grande, occhi sporgenti con palpebre pesanti, naso a salsicciotto,
 * labbra a ciambella e barba piena sulla metà inferiore; corpo a fagiolo, arti a capsula, tutto liscio e opaco.
 * Proporzioni (unità mondo, origine ai piedi, faccia verso +z):
 * gambe 0..0.42 (coscia 0.2 + stinco/scarpa 0.22), busto 0.37..0.83, testa centro 0.94 (semiasse verticale 0.24) => alto ~1.18.
 * Seduto: cosce in avanti appoggiate sulla seduta, stinchi verticali allungati fino al pavimento (vedi ./dimensions).
 */
const HALF_PI = Math.PI / 2;
export const HEAD_Y = 0.94;
/** raggio base del cranio; la scala SKULL lo rende un uovo un po' più alto che largo */
const SKULL_R = 0.22;
const SKULL: [number, number, number] = [0.9, 1.08, 0.92];

export const SHOULDER_X = 0.22;
export const SHOULDER_Y = 0.72;
/** inclinazione laterale delle braccia (verso l'esterno) */
export const ARM_SPLAY = 0.08;
/** spalla → centro mano lungo il braccio */
export const HAND_DIST = 0.27;

const SHOE_COLOR = '#2e2a2f';
const PUPIL_COLOR = '#151217';
const EYE_WHITE = '#f6f3ee';
const MOUTH_COLOR = '#2a0f17';
const GEAR_COLOR = '#2d2f36';
const TIE_COLOR = '#9b2226';
const SOLE_COLOR = '#efe9df';

type GeometryKey =
  | 'skull' | 'beard' | 'ear' | 'eye' | 'pupil' | 'lidTop' | 'lidLow' | 'nose' | 'lips' | 'mouth'
  | 'torso' | 'pantsTop' | 'arm' | 'hand' | 'hipCap' | 'thigh' | 'knee' | 'shin' | 'cuff' | 'shoe' | 'sole'
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
    // gamba di pantalone continua: coscia e stinco cilindrici appena rastremati, raccordati da anca e ginocchio
    hipCap: new SphereGeometry(THIGH_THICKNESS / 2, 20, 12),
    thigh: new CylinderGeometry(THIGH_THICKNESS / 2, 0.074, 0.2, 24, 1, true),
    knee: new SphereGeometry(0.074, 20, 12),
    shin: new CylinderGeometry(0.074, 0.068, 0.16, 24, 1, true),
    cuff: new CylinderGeometry(0.073, 0.076, 0.03, 24),
    // sneaker: tomaia a capsula distesa in avanti e suola chiara un po' più larga
    shoe: new CapsuleGeometry(0.058, 0.09, 8, 16),
    sole: new CapsuleGeometry(0.062, 0.1, 8, 16),
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

type Materials = Record<
  'skin' | 'warm' | 'lips' | 'mouth' | 'eye' | 'pupil' | 'hair' | 'beard' | 'shirt' | 'pants' | 'shoe' | 'sole' | 'gear' | 'tie',
  MeshStandardMaterial
>;

/**
 * Corpo del personaggio (gambe, busto, braccia, testa) a riposo: i gruppi animati si agganciano ai ref di `rig`
 * (vedi useCharacterRig). `children`: oggetti che seguono il corpo (tazza, post-it).
 */
export function CharacterBody({ preset, rig, children }: { preset: CharacterPreset; rig: Rig; children?: ReactNode }): ReactNode {
  // i ref con suffisso Ref: così il React Compiler li riconosce come ref passati a `ref`
  const { body: bodyRef, torso: torsoRef, head: headRef, hipL: hipLRef, hipR: hipRRef, kneeL: kneeLRef, kneeR: kneeRRef, armL: armLRef, armR: armRRef } = rig;
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
      sole: material(SOLE_COLOR),
      gear: material(GEAR_COLOR, true, 0.7),
      tie: material(TIE_COLOR),
    }),
    [preset],
  );

  const leg = (side: 1 | -1) => (
    <group
      position={[0.095 * side, HIP_Y, 0]}
      ref={side === 1 ? hipRRef : hipLRef}
    >
      <mesh geometry={g.hipCap} material={m.pants} castShadow />
      <mesh geometry={g.thigh} material={m.pants} position={[0, -0.1, 0]} castShadow />
      <group position={[0, -0.2, 0]} ref={side === 1 ? kneeRRef : kneeLRef}>
        <mesh geometry={g.knee} material={m.pants} castShadow />
        <mesh geometry={g.shin} material={m.pants} position={[0, -0.08, 0]} castShadow />
        <mesh geometry={g.cuff} material={m.pants} position={[0, -0.152, 0]} castShadow />
        <mesh geometry={g.sole} material={m.sole} position={[0, -0.208, 0.03]} rotation-x={HALF_PI} scale={[1.05, 1, 0.28]} />
        <mesh geometry={g.shoe} material={m.shoe} position={[0, -0.188, 0.03]} rotation-x={HALF_PI} scale={[1, 1, 0.62]} castShadow />
      </group>
    </group>
  );

  const arm = (side: 1 | -1) => (
    <group
      position={[SHOULDER_X * side, SHOULDER_Y, 0]}
      rotation={[0, 0, ARM_SPLAY * side]}
      ref={side === 1 ? armRRef : armLRef}
    >
      <mesh geometry={g.arm} material={m.shirt} position={[0, -0.12, 0]} castShadow />
      <mesh geometry={g.hand} material={m.skin} position={[0, -HAND_DIST, 0]} castShadow />
    </group>
  );

  return (
    <group>
      <group ref={bodyRef}>
        {leg(-1)}
        {leg(1)}
        {/* busto a fagiolo: camicia sopra, calotta dei pantaloni sotto */}
        <group ref={torsoRef} position={[0, 0.6, 0]} scale={[1.15, 1, 0.9]}>
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
        {children}
        <group ref={headRef} position={[0, HEAD_Y, 0]}>
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
