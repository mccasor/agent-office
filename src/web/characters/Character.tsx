import type { ReactNode } from 'react';
import type { CharacterPreset } from './presets';
import { ARM_SPLAY, CharacterBody, HAND_DIST, SHOULDER_X, SHOULDER_Y } from './CharacterBody';
import { CoffeeCup } from './CoffeeCup';
import { HOLD_ARM, holdsCup, useCharacterRig, type CharacterPose } from './useCharacterRig';

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

/**
 * Personaggio procedurale in stile clay (solo primitive three.js): corpo (CharacterBody) animato dal rig
 * (useCharacterRig) secondo la `pose`, che decide anche se regge la tazza di caffè.
 * `leftHand`: oggetto retto con la sinistra (es. un post-it), nascosto mentre la alza verso la board.
 */
export function Character({ preset, pose, leftHand }: {
  preset: CharacterPreset;
  pose: CharacterPose;
  leftHand?: ReactNode;
}): ReactNode {
  const rig = useCharacterRig(preset.id, pose, !!leftHand);
  return (
    <CharacterBody preset={preset} rig={rig}>
      {holdsCup(pose) && <CoffeeCup position={CUP_IN_HAND} />}
      {leftHand && pose !== 'reach' && <group position={LEFT_IN_HAND}>{leftHand}</group>}
    </CharacterBody>
  );
}
