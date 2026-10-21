import { useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { CylinderGeometry, MeshStandardMaterial, SphereGeometry, TorusGeometry, type Group } from 'three';

const CUP_H = 0.1;

const G = {
  cup: new CylinderGeometry(0.045, 0.036, CUP_H, 10),
  coffee: new CylinderGeometry(0.04, 0.04, 0.005, 10),
  handle: new TorusGeometry(0.025, 0.008, 4, 8, Math.PI),
  puff: new SphereGeometry(0.022, 6, 4),
};

const M = {
  cup: new MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.6, flatShading: true }),
  coffee: new MeshStandardMaterial({ color: '#4a2c1a', roughness: 0.4 }),
  steam: new MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false }),
};

const PUFFS = 3;
const STEAM_PERIOD = 1.8; // s

/** Tazza di caffè (origine sul fondo) con tre sbuffi di vapore che salgono e svaniscono. */
export function CoffeeCup({ position, rotationY = 0 }: { position?: [number, number, number]; rotationY?: number }): ReactNode {
  const puffs = useRef<(Group | null)[]>([]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    puffs.current.forEach((p, i) => {
      if (!p) return;
      const k = ((t / STEAM_PERIOD + i / PUFFS) % 1 + 1) % 1;
      p.position.set(Math.sin((t + i) * 3) * 0.015, CUP_H + 0.02 + k * 0.18, 0);
      p.scale.setScalar(0.6 + k * 1.2);
      p.visible = k < 0.95;
    });
  });

  return (
    <group position={position} rotation-y={rotationY}>
      <mesh geometry={G.cup} material={M.cup} position={[0, CUP_H / 2, 0]} castShadow />
      <mesh geometry={G.coffee} material={M.coffee} position={[0, CUP_H - 0.008, 0]} />
      <mesh geometry={G.handle} material={M.cup} position={[0.045, CUP_H / 2, 0]} rotation-z={-Math.PI / 2} />
      {Array.from({ length: PUFFS }, (_, i) => (
        <group key={i} ref={(o) => { puffs.current[i] = o; }}>
          <mesh geometry={G.puff} material={M.steam} />
        </group>
      ))}
    </group>
  );
}
