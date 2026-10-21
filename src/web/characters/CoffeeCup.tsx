import { useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { CylinderGeometry, LatheGeometry, MeshStandardMaterial, SphereGeometry, TorusGeometry, Vector2, type Group } from 'three';

const CUP_H = 0.1;

/** Profilo della tazza (origine sul fondo): fondo arrotondato, parete spessa e orlo tondo, ruotato attorno a y. */
function cupProfile(): Vector2[] {
  const pts = [new Vector2(0, 0)];
  // fondo che curva verso la parete esterna
  for (let i = 0; i <= 4; i++) {
    const a = -Math.PI / 2 + (i / 4) * (Math.PI / 2);
    pts.push(new Vector2(0.03 + Math.cos(a) * 0.008, 0.008 + Math.sin(a) * 0.008));
  }
  pts.push(new Vector2(0.044, CUP_H - 0.008));
  // orlo a mezzo toro, poi la parete interna scende fino al caffè
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * Math.PI;
    pts.push(new Vector2(0.0405 + Math.cos(a) * 0.0045, CUP_H - 0.008 + Math.sin(a) * 0.0045));
  }
  pts.push(new Vector2(0.034, CUP_H - 0.03));
  return pts;
}

const G = {
  cup: new LatheGeometry(cupProfile(), 24),
  coffee: new CylinderGeometry(0.035, 0.035, 0.004, 20),
  handle: new TorusGeometry(0.024, 0.009, 10, 16, Math.PI),
  puff: new SphereGeometry(0.022, 12, 8),
};

/** materiali opachi e lisci, come i personaggi */
const M = {
  cup: new MeshStandardMaterial({ color: '#f6f1e8', roughness: 0.9 }),
  coffee: new MeshStandardMaterial({ color: '#4a2c1a', roughness: 0.6 }),
  steam: new MeshStandardMaterial({ color: '#ffffff', roughness: 1, transparent: true, opacity: 0.55, depthWrite: false }),
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
      <mesh geometry={G.cup} material={M.cup} castShadow />
      <mesh geometry={G.coffee} material={M.coffee} position={[0, CUP_H - 0.022, 0]} />
      <mesh geometry={G.handle} material={M.cup} position={[0.043, CUP_H / 2, 0]} rotation-z={-Math.PI / 2} />
      {Array.from({ length: PUFFS }, (_, i) => (
        <group key={i} ref={(o) => { puffs.current[i] = o; }}>
          <mesh geometry={G.puff} material={M.steam} />
        </group>
      ))}
    </group>
  );
}
