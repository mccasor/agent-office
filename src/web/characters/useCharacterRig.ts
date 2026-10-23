import { useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { MathUtils, type Group } from 'three';
import { HIP_Y, SEATED_HIP_Y, SEATED_SHIN_SCALE } from './dimensions';
import { HEAD_Y } from './CharacterBody';

/**
 * Posa del personaggio, con la tazza di caffè implicita: la regge con la destra in ogni posa tranne `type`
 * (seduto alla scrivania, la tazza è appoggiata sul piano).
 * - `stand`: in piedi, respira; `walk`: cammina; `reach`: in piedi, alza la sinistra verso la board;
 * - `type`: seduto, digita con la testa china sullo schermo; `lounge`: seduto in relax, braccia sulle gambe.
 */
export type CharacterPose = 'stand' | 'walk' | 'reach' | 'type' | 'lounge';

const isSeated = (pose: CharacterPose): boolean => pose === 'type' || pose === 'lounge';
export const holdsCup = (pose: CharacterPose): boolean => pose !== 'type';

const HALF_PI = Math.PI / 2;
/** braccio destro piegato in avanti per reggere la tazza */
export const HOLD_ARM = -0.9;
/** braccio sinistro alzato verso la board */
const REACH_ARM = -2.3;
/** braccia appoggiate sulle gambe da seduto, senza digitare */
const REST_ARM = -0.45;

/** Ref dei gruppi animati del corpo, da agganciare in CharacterBody. */
export type Rig = Record<'body' | 'torso' | 'head' | 'armL' | 'armR' | 'hipL' | 'hipR' | 'kneeL' | 'kneeR', RefObject<Group | null>>;

/** Fase deterministica per id, così personaggi diversi non si muovono all'unisono. */
function phaseOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 159.15;
}

/**
 * Rig del personaggio animato via useFrame: verso la posa gli angoli di anche, ginocchia e braccia (smorzati),
 * più respiro, passo e cenni della testa. `carrying`: regge un oggetto con la sinistra (es. un post-it).
 */
export function useCharacterRig(id: string, pose: CharacterPose, carrying: boolean): Rig {
  const phase = useMemo(() => phaseOf(id), [id]);
  const rig: Rig = {
    body: useRef<Group>(null),
    torso: useRef<Group>(null),
    head: useRef<Group>(null),
    armL: useRef<Group>(null),
    armR: useRef<Group>(null),
    hipL: useRef<Group>(null),
    hipR: useRef<Group>(null),
    kneeL: useRef<Group>(null),
    kneeR: useRef<Group>(null),
  };

  useFrame((state, delta) => {
    const r = {
      body: rig.body.current, torso: rig.torso.current, head: rig.head.current, armL: rig.armL.current, armR: rig.armR.current,
      hipL: rig.hipL.current, hipR: rig.hipR.current, kneeL: rig.kneeL.current, kneeR: rig.kneeR.current,
    };
    if (!r.body || !r.torso || !r.head || !r.armL || !r.armR || !r.hipL || !r.hipR || !r.kneeL || !r.kneeR) return;
    const t = state.clock.elapsedTime + phase;
    const dt = Math.min(delta, 0.1);
    const k = 12;
    const damp = (v: number, target: number) => MathUtils.damp(v, target, k, dt);
    const seated = isSeated(pose);
    const walking = pose === 'walk';

    let hipL = 0, hipR = 0, kneeL = 0, kneeR = 0, armL: number, armR: number;
    let bodyY = 0, bodyZ = 0, lean = 0, breath = 0, nod = 0;

    if (seated) {
      hipL = hipR = -HALF_PI;
      kneeL = kneeR = HALF_PI;
      bodyY = SEATED_HIP_Y - HIP_Y;
      bodyZ = -0.1;
      lean = 0.08;
      if (pose === 'type') {
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
    if (holdsCup(pose)) armR = HOLD_ARM + Math.sin(t * 2) * 0.02;
    if (pose === 'reach') armL = REACH_ARM + Math.sin(t * 6) * 0.08;
    else if (carrying) armL = HOLD_ARM;

    r.hipL.rotation.x = damp(r.hipL.rotation.x, hipL);
    r.hipR.rotation.x = damp(r.hipR.rotation.x, hipR);
    r.kneeL.rotation.x = damp(r.kneeL.rotation.x, kneeL);
    r.kneeR.rotation.x = damp(r.kneeR.rotation.x, kneeR);
    const shin = damp(r.kneeL.scale.y, seated ? SEATED_SHIN_SCALE : 1);
    r.kneeL.scale.y = r.kneeR.scale.y = shin;
    r.armL.rotation.x = damp(r.armL.rotation.x, armL);
    r.armR.rotation.x = damp(r.armR.rotation.x, armR);
    r.body.position.y = walking ? bodyY : damp(r.body.position.y, bodyY);
    r.body.position.z = damp(r.body.position.z, bodyZ);
    r.body.rotation.x = damp(r.body.rotation.x, lean);
    r.torso.scale.set(1 + breath * 0.5, 1 + breath, 1 + breath * 0.5);
    r.head.position.y = HEAD_Y + breath * 0.25;
    r.head.rotation.x = damp(r.head.rotation.x, nod);
  });

  return rig;
}
