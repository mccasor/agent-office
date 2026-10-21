import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import { SphereGeometry, type Group } from 'three';
import { capsule, clay, rbox } from './clay';

const BALL = new SphereGeometry(0.17, 24, 16);
const BAR = rbox(0.05, 0.13, 0.03, 0.015);
const DOT = capsule(0.028, 0.056, 12);
const RED = clay('#e5483a', { emissive: '#e5483a', emissiveIntensity: 0.35 });
const WHITE = clay('#ffffff');

/** Fumetto rosso con "!" che ondeggia sopra la testa: la sessione aspetta un input dell'utente. */
export function AlertBubble({ y = 2.2 }: { y?: number }) {
  const group = useRef<Group>(null);
  useFrame((state) => {
    if (group.current) group.current.position.y = y + Math.sin(state.clock.elapsedTime * 4) * 0.05;
  });
  return (
    <group ref={group} position={[0, y, 0]}>
      <Billboard>
        <mesh geometry={BALL} material={RED} />
        <mesh geometry={BAR} material={WHITE} position={[0, 0.035, 0.165]} />
        <mesh geometry={DOT} material={WHITE} position={[0, -0.08, 0.165]} />
      </Billboard>
    </group>
  );
}
