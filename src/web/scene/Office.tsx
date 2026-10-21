import { useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
import { BOSS_W, cellToWorld, coffeeBarCells, deskCells, LOUNGE_W, loungeTable, plantCells, type OfficeLayout } from './layout';
import { SEAT_HEIGHT } from '../characters/dimensions';

/** Pareti di fondo (nord, ovest) alte; quelle verso la camera (sud, est) basse, come in uno spaccato. */
const WALL_H = 2.2;
const FRONT_WALL_H = 0.35;
const WALL_T = 0.3;
const GLASS_H = 1.5;
/** quota del piano delle scrivanie (condivisa con la tazza appoggiata, vedi DESK_CUP) */
export const DESK_TOP_Y = 0.745;
/** tazza appoggiata sulla scrivania, nel sistema del posto (+z verso la scrivania) */
export const DESK_CUP: [number, number, number] = [0.32, DESK_TOP_Y, 0.72];

const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, flatShading: true, ...extra });

/** Materiali e geometrie condivisi (low-poly, flat), palette dell'immagine di riferimento: rovere, nero, verde, moquette. */
const M = {
  base: mat('#f4f2ee'),
  carpet: mat('#cfccc6'),
  parquet: mat('#b98b5e'),
  rug: mat('#e3d8c6'),
  bossRug: mat('#8c8f7a'),
  wallCap: mat('#f4f2ee'),
  wallDark: mat('#2a2a2c'),
  door: mat('#f2a541', { emissive: '#f2a541', emissiveIntensity: 0.35 }),
  oak: mat('#cfa979'),
  walnut: mat('#6b4a33'),
  black: mat('#232325', { roughness: 0.6 }),
  chrome: mat('#c9ccd1', { metalness: 0.6, roughness: 0.35 }),
  screen: mat('#1d2a38', { emissive: '#3d6e99', emissiveIntensity: 0.35 }),
  lampLight: mat('#fff4d6', { emissive: '#ffe7a8', emissiveIntensity: 0.8 }),
  leather: mat('#5b3a29'),
  fabric: mat('#cdb79e'),
  cushion: mat('#bfa587'),
  glass: new THREE.MeshStandardMaterial({ color: '#d7e8f0', transparent: true, opacity: 0.22, roughness: 0.1, depthWrite: false }),
  window: mat('#e8f1f6', { emissive: '#dceaf3', emissiveIntensity: 0.5 }),
  gold: mat('#c9a227', { metalness: 0.7, roughness: 0.3 }),
  pot: mat('#2a2a2c'),
  leaf: mat('#4f8a4f'),
  leafDark: mat('#356b3a'),
  leafLight: mat('#6fa35c'),
  paper: mat('#f6f1e7'),
};

const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
  cone: new THREE.ConeGeometry(0.09, 0.12, 8, 1, true),
  pot: new THREE.CylinderGeometry(0.2, 0.16, 0.4, 8),
  leaf: new THREE.IcosahedronGeometry(0.32, 0),
  sphere: new THREE.SphereGeometry(0.5, 8, 6),
};

/** Doghe verticali in rovere (texture procedurale), ripetute lungo le pareti di fondo. */
function slatTexture(length: number): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 8;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#d2ab7b';
  ctx.fillRect(0, 0, 128, 8);
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = '#9c7449';
    ctx.fillRect(i * 16, 0, 3, 8);
    ctx.fillStyle = '#ddb98b';
    ctx.fillRect(i * 16 + 3, 0, 2, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(length, 1);
  return t;
}

/** Ufficio: stanza del boss, openspace a isole con fioriere, area relax, pareti a doghe e vetrate, luci. */
export function Office({ layout }: { layout: OfficeLayout }): ReactNode {
  const desks = useMemo(() => deskCells(layout), [layout]);
  const plants = useMemo(() => plantCells(layout), [layout]);
  const walls = useMemo(() => wallSegments(layout), [layout]);
  const { width: w, depth: d } = layout;
  const span = Math.max(w, d);
  const at = (x: number, z: number) => cellToWorld(layout, { x, z });
  const [x0w, , z0w] = at(0, 0);
  const bossCenter = at((1 + BOSS_W) / 2, (d - 1) / 2);
  const loungeX = w - 1 - LOUNGE_W + 1;

  return (
    <group>
      <hemisphereLight args={['#fffaf0', '#b8b0a2', 1.1]} />
      <directionalLight
        position={[span * 0.45, span * 0.9, span * 0.35]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0005}
        shadow-radius={4}
        shadow-camera-left={-span * 0.8}
        shadow-camera-right={span * 0.8}
        shadow-camera-top={span * 0.8}
        shadow-camera-bottom={-span * 0.8}
        shadow-camera-near={0.5}
        shadow-camera-far={span * 3}
      />

      {/* basamento bianco, moquette dell'openspace, parquet del boss, tappeto dell'area relax */}
      <mesh geometry={G.box} material={M.base} position={[0, -0.12, 0]} scale={[w + 0.2, 0.24, d + 0.2]} receiveShadow />
      <mesh geometry={G.box} material={M.carpet} position={[0, 0.002, 0]} scale={[w - 1, 0.004, d - 1]} receiveShadow />
      <mesh geometry={G.box} material={M.parquet} position={[bossCenter[0], 0.005, bossCenter[2]]} scale={[BOSS_W + 0.5, 0.006, d - 1]} receiveShadow />
      <mesh geometry={G.box} material={M.bossRug} position={[at(2, 4)[0], 0.01, at(2, 4)[2]]} scale={[2.2, 0.006, 3]} receiveShadow />
      <mesh geometry={G.box} material={M.rug} position={[at(loungeX, (d - 1) / 2)[0], 0.008, at(loungeX, (d - 1) / 2)[2]]} scale={[LOUNGE_W + 0.4, 0.006, d - 2.4]} receiveShadow />

      {walls.map((s, i) => (
        <Wall key={i} segment={s} />
      ))}
      <BackWallDecor layout={layout} x0={x0w} z0={z0w} />
      <BossGlass layout={layout} />
      <Door layout={layout} />

      {layout.islands.map((c) => (
        <group key={`${c.x},${c.z}`} position={at(c.x + 0.5, c.z + 1.5)}>
          <Planter length={2} />
        </group>
      ))}
      {desks.map((desk) => (
        <group key={desk.seatId} position={at(desk.cell.x, desk.cell.z)} rotation-y={desk.facing}>
          <DeskModel />
        </group>
      ))}
      {layout.seats.map((s) => (
        <group key={s.id} position={at(s.cell.x, s.cell.z)} rotation-y={s.facing}>
          <ChairModel />
        </group>
      ))}

      <BossOffice layout={layout} />
      <Lounge layout={layout} />

      {plants.map((p, i) => (
        <group key={i} position={at(p.x, p.z)} rotation-y={i * 1.3}>
          <PlantModel />
        </group>
      ))}
    </group>
  );
}

interface WallSegment { position: [number, number, number]; size: [number, number]; height: number; slats: boolean }

/** Pareti sulle celle perimetrali (spessore WALL_T al centro della cella), parete sud interrotta dalla porta. */
function wallSegments(layout: OfficeLayout): WallSegment[] {
  const [xW, , zN] = cellToWorld(layout, { x: 0, z: 0 });
  const [xE, , zS] = cellToWorld(layout, { x: layout.width - 1, z: layout.depth - 1 });
  const [xd] = cellToWorld(layout, layout.door);
  const h = WALL_T / 2;
  const along = (x0: number, x1: number, z: number, height: number, slats: boolean): WallSegment =>
    ({ position: [(x0 + x1) / 2, 0, z], size: [x1 - x0, WALL_T], height, slats });
  return [
    along(xW - h, xE + h, zN, WALL_H, true),
    along(xW - h, xd - 0.5, zS, FRONT_WALL_H, false),
    along(xd + 0.5, xE + h, zS, FRONT_WALL_H, false),
    { position: [xW, 0, (zN + zS) / 2], size: [WALL_T, zS - zN + WALL_T], height: WALL_H, slats: true },
    { position: [xE, 0, (zN + zS) / 2], size: [WALL_T, zS - zN + WALL_T], height: FRONT_WALL_H, slats: false },
  ];
}

function Wall({ segment: s }: { segment: WallSegment }): ReactNode {
  const material = useMemo(() => {
    const map = s.slats ? slatTexture(Math.max(s.size[0], s.size[1])) : null;
    return map ? mat('#ffffff', { map }) : M.base;
  }, [s]);
  return (
    <group position={s.position}>
      <mesh geometry={G.box} material={material} position={[0, s.height / 2, 0]} scale={[s.size[0], s.height, s.size[1]]} castShadow receiveShadow />
      <mesh geometry={G.box} material={M.wallCap} position={[0, s.height + 0.015, 0]} scale={[s.size[0] + 0.02, 0.03, s.size[1] + 0.02]} />
    </group>
  );
}

/** Finestre a riquadri neri e lesene scure sulle pareti di fondo, quadro e libreria nella stanza del boss. */
function BackWallDecor({ layout, x0, z0 }: { layout: OfficeLayout; x0: number; z0: number }): ReactNode {
  const face = z0 + WALL_T / 2 + 0.02;
  const westFace = x0 + WALL_T / 2 + 0.02;
  const windowsX = [...new Set(layout.islands.map((c) => cellToWorld(layout, { x: c.x + 0.5, z: 0 })[0]))];
  const pilasters = [cellToWorld(layout, layout.bossDoor)[0], cellToWorld(layout, { x: layout.width - 1 - LOUNGE_W - 0.5, z: 0 })[0]];
  return (
    <group>
      {windowsX.map((x) => (
        <group key={x} position={[x, 0, face]}>
          <mesh geometry={G.box} material={M.window} position={[0, 1.3, 0]} scale={[1.7, 1.3, 0.02]} />
          {[-0.85, -0.28, 0.28, 0.85].map((dx) => (
            <mesh key={dx} geometry={G.box} material={M.black} position={[dx, 1.3, 0.02]} scale={[0.04, 1.34, 0.03]} />
          ))}
          {[0.65, 1.3, 1.95].map((y) => (
            <mesh key={y} geometry={G.box} material={M.black} position={[0, y, 0.02]} scale={[1.74, 0.04, 0.03]} />
          ))}
        </group>
      ))}
      {pilasters.map((x) => (
        <mesh key={x} geometry={G.box} material={M.wallDark} position={[x, WALL_H / 2, face]} scale={[0.6, WALL_H, 0.04]} />
      ))}
      {/* stanza del boss: quadro sulla parete ovest, libreria sulla parete nord */}
      <group position={[westFace, 1.35, cellToWorld(layout, { x: 0, z: 5 })[2]]}>
        <mesh geometry={G.box} material={M.black} scale={[0.04, 0.8, 1.1]} />
        <mesh geometry={G.box} material={M.door} position={[0.025, 0, 0]} scale={[0.01, 0.66, 0.96]} />
      </group>
      <group position={[cellToWorld(layout, { x: 2, z: 0 })[0], 0, face + 0.15]}>
        <mesh geometry={G.box} material={M.walnut} position={[0, 0.9, 0]} scale={[1.1, 1.8, 0.3]} castShadow />
        {[0.45, 0.9, 1.35].map((y, i) => (
          <group key={y}>
            <mesh geometry={G.box} material={M.black} position={[0, y, 0.02]} scale={[1.0, 0.03, 0.28]} />
            <mesh geometry={G.box} material={i === 1 ? M.oak : M.paper} position={[-0.2 + i * 0.12, y + 0.16, 0.02]} scale={[0.4, 0.28, 0.2]} />
          </group>
        ))}
      </group>
    </group>
  );
}

/** Vetrata con montanti neri lungo la colonna BOSS_W + 1, aperta in corrispondenza di bossDoor. */
function BossGlass({ layout }: { layout: OfficeLayout }): ReactNode {
  const x = cellToWorld(layout, layout.bossDoor)[0];
  const [, , zN] = cellToWorld(layout, { x: 0, z: 0.5 });
  const [, , zDoorN] = cellToWorld(layout, { x: 0, z: layout.bossDoor.z - 0.5 });
  const [, , zDoorS] = cellToWorld(layout, { x: 0, z: layout.bossDoor.z + 0.5 });
  const [, , zS] = cellToWorld(layout, { x: 0, z: layout.depth - 1.5 });
  const panes: [number, number][] = [[zN, zDoorN], [zDoorS, zS]];
  return (
    <group position={[x, 0, 0]}>
      {panes.map(([a, b]) => (
        <group key={a}>
          <mesh geometry={G.box} material={M.glass} position={[0, GLASS_H / 2, (a + b) / 2]} scale={[0.04, GLASS_H, b - a]} />
          <mesh geometry={G.box} material={M.black} position={[0, GLASS_H, (a + b) / 2]} scale={[0.06, 0.05, b - a]} />
          <mesh geometry={G.box} material={M.black} position={[0, 0.03, (a + b) / 2]} scale={[0.06, 0.06, b - a]} />
          {Array.from({ length: Math.round(b - a) + 1 }, (_, i) => (
            <mesh key={i} geometry={G.box} material={M.black} position={[0, GLASS_H / 2, a + i * ((b - a) / Math.round(b - a))]} scale={[0.06, GLASS_H, 0.05]} castShadow />
          ))}
        </group>
      ))}
    </group>
  );
}

function Door({ layout }: { layout: OfficeLayout }): ReactNode {
  const [x, , z] = cellToWorld(layout, layout.door);
  return (
    <group position={[x, 0, z]}>
      <mesh geometry={G.box} material={M.door} position={[0, 0.01, -0.5]} scale={[0.9, 0.02, 1.9]} receiveShadow />
      {[-0.5, 0.5].map((dx) => (
        <mesh key={dx} geometry={G.box} material={M.black} position={[dx, (FRONT_WALL_H + 0.45) / 2, 0]} scale={[0.1, FRONT_WALL_H + 0.45, WALL_T + 0.1]} castShadow />
      ))}
    </group>
  );
}

/** Scrivania in rovere con telaio nero: local +z verso il posto, monitor e lampada verso la fioriera. */
function DeskModel(): ReactNode {
  return (
    <group>
      <mesh geometry={G.box} material={M.oak} position={[0, DESK_TOP_Y - 0.025, 0.1]} scale={[1, 0.05, 0.8]} castShadow receiveShadow />
      {[-0.46, 0.46].map((x) => (
        <group key={x} position={[x, 0, 0.1]}>
          <mesh geometry={G.box} material={M.black} position={[0, 0.36, 0.3]} scale={[0.04, 0.72, 0.04]} />
          <mesh geometry={G.box} material={M.black} position={[0, 0.36, -0.3]} scale={[0.04, 0.72, 0.04]} />
          <mesh geometry={G.box} material={M.black} position={[0, 0.02, 0]} scale={[0.04, 0.04, 0.68]} />
        </group>
      ))}
      {/* monitor tutto-in-uno nero */}
      <group position={[0.05, DESK_TOP_Y, -0.12]}>
        <mesh geometry={G.box} material={M.black} position={[0, 0.01, 0]} scale={[0.2, 0.02, 0.14]} />
        <mesh geometry={G.box} material={M.black} position={[0, 0.12, -0.02]} scale={[0.05, 0.22, 0.03]} />
        <mesh geometry={G.box} material={M.black} position={[0, 0.34, 0]} scale={[0.56, 0.36, 0.03]} castShadow />
        <mesh geometry={G.box} material={M.screen} position={[0, 0.35, 0.017]} scale={[0.52, 0.3, 0.004]} />
      </group>
      <mesh geometry={G.box} material={M.black} position={[0.05, DESK_TOP_Y + 0.008, 0.2]} scale={[0.38, 0.015, 0.12]} />
      <DeskLamp position={[-0.38, DESK_TOP_Y, -0.15]} />
    </group>
  );
}

/** Lampada da tavolo nera a braccio snodato, paralume verso il piano. */
function DeskLamp({ position }: { position: [number, number, number] }): ReactNode {
  return (
    <group position={position}>
      <mesh geometry={G.cyl} material={M.black} position={[0, 0.01, 0]} scale={[0.12, 0.02, 0.12]} />
      <mesh geometry={G.box} material={M.black} position={[0, 0.2, -0.04]} rotation-x={-0.25} scale={[0.02, 0.4, 0.02]} />
      <mesh geometry={G.box} material={M.black} position={[0, 0.4, 0.08]} rotation-x={1.1} scale={[0.02, 0.3, 0.02]} />
      <mesh geometry={G.cone} material={M.black} position={[0, 0.42, 0.22]} rotation-x={-0.5} />
      <mesh geometry={G.sphere} material={M.lampLight} position={[0, 0.38, 0.24]} scale={0.05} />
    </group>
  );
}

/** Fioriera nera lunga `length` con verde in cima, sul giunto tra due file di scrivanie. */
function Planter({ length }: { length: number }): ReactNode {
  const bushes = Math.round(length * 3);
  return (
    <group>
      <mesh geometry={G.box} material={M.black} position={[0, 0.5, 0]} scale={[length, 1, 0.4]} castShadow receiveShadow />
      {Array.from({ length: bushes }, (_, i) => {
        const x = -length / 2 + (i + 0.5) * (length / bushes);
        const leaf = i % 3 === 0 ? M.leafLight : i % 2 ? M.leafDark : M.leaf;
        return (
          <group key={i} position={[x, 1.02, 0]} rotation-y={i * 0.9}>
            <mesh geometry={G.leaf} material={leaf} scale={[0.75, 0.6, 0.6]} castShadow />
            <mesh geometry={G.leaf} material={M.leaf} position={[0.1, 0.14, 0.04]} scale={0.4} castShadow />
          </group>
        );
      })}
    </group>
  );
}

const SEAT_T = 0.08;

/** Sedia nera con base a stella cromata: local +z verso la scrivania, schienale dietro; seduta a SEAT_HEIGHT. */
function ChairModel({ seat = M.black, tall = false }: { seat?: THREE.Material; tall?: boolean }): ReactNode {
  const backH = tall ? 0.75 : 0.5;
  return (
    <group position={[0, 0, -0.08]}>
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} geometry={G.box} material={M.chrome} position={[Math.sin(i * 1.2566) * 0.14, 0.025, Math.cos(i * 1.2566) * 0.14]} rotation-y={i * 1.2566} scale={[0.03, 0.03, 0.28]} />
      ))}
      <mesh geometry={G.cyl} material={M.chrome} position={[0, (SEAT_HEIGHT - SEAT_T) / 2, 0]} scale={[0.05, SEAT_HEIGHT - SEAT_T, 0.05]} />
      <mesh geometry={G.box} material={seat} position={[0, SEAT_HEIGHT - SEAT_T / 2, 0]} scale={[0.46, SEAT_T, 0.44]} castShadow receiveShadow />
      {[-0.24, 0.24].map((x) => (
        <mesh key={x} geometry={G.box} material={M.chrome} position={[x, SEAT_HEIGHT + 0.12, -0.02]} scale={[0.025, 0.025, 0.36]} />
      ))}
      <mesh geometry={G.box} material={seat} position={[0, SEAT_HEIGHT + backH / 2 - 0.01, -0.21]} scale={[0.44, backH, 0.07]} castShadow />
    </group>
  );
}

/** Stanza del boss: scrivania in noce con due monitor, poltrona in pelle, targhetta e statuetta dorate. */
function BossOffice({ layout }: { layout: OfficeLayout }): ReactNode {
  const seat = layout.bossSeat;
  const at = (x: number, z: number) => cellToWorld(layout, { x, z });
  return (
    <group>
      <group position={at(seat.cell.x, seat.cell.z + 1)} rotation-y={seat.facing + Math.PI}>
        <mesh geometry={G.box} material={M.walnut} position={[0, DESK_TOP_Y - 0.03, 0.1]} scale={[1.8, 0.06, 0.85]} castShadow receiveShadow />
        <mesh geometry={G.box} material={M.walnut} position={[0, 0.36, -0.28]} scale={[1.76, 0.7, 0.04]} castShadow />
        {[-0.86, 0.86].map((x) => (
          <mesh key={x} geometry={G.box} material={M.black} position={[x, 0.36, 0.1]} scale={[0.06, 0.72, 0.8]} />
        ))}
        {[-0.3, 0.3].map((x) => (
          <group key={x} position={[x, DESK_TOP_Y, -0.1]} rotation-y={-x * 0.6}>
            <mesh geometry={G.box} material={M.black} position={[0, 0.12, 0]} scale={[0.05, 0.22, 0.03]} />
            <mesh geometry={G.box} material={M.black} position={[0, 0.34, 0]} scale={[0.56, 0.34, 0.03]} castShadow />
            <mesh geometry={G.box} material={M.screen} position={[0, 0.35, 0.017]} scale={[0.52, 0.28, 0.004]} />
          </group>
        ))}
        <mesh geometry={G.box} material={M.black} position={[0, DESK_TOP_Y + 0.008, 0.22]} scale={[0.4, 0.015, 0.12]} />
        <DeskLamp position={[-0.75, DESK_TOP_Y, -0.1]} />
        {/* statuetta dorata e targhetta "Claudio Code" sul bordo verso la stanza */}
        <group position={[0.75, DESK_TOP_Y, -0.1]}>
          <mesh geometry={G.box} material={M.black} position={[0, 0.03, 0]} scale={[0.1, 0.06, 0.1]} />
          <mesh geometry={G.box} material={M.gold} position={[0, 0.14, 0]} rotation-z={0.2} scale={[0.05, 0.16, 0.04]} />
          <mesh geometry={G.sphere} material={M.gold} position={[0.02, 0.25, 0]} scale={0.06} />
        </group>
        <mesh geometry={G.box} material={M.gold} position={[0, DESK_TOP_Y - 0.03, -0.31]} scale={[0.4, 0.06, 0.01]} />
      </group>
      <group position={at(seat.cell.x, seat.cell.z)} rotation-y={seat.facing}>
        <ChairModel seat={M.leather} tall />
      </group>
    </group>
  );
}

/** Area relax: due divani affacciati sul tavolino, bancone con macchina del caffè. */
function Lounge({ layout }: { layout: OfficeLayout }): ReactNode {
  const table = loungeTable(layout);
  const at = (x: number, z: number) => cellToWorld(layout, { x, z });
  const bar = coffeeBarCells(layout);
  const columns = [
    { x: table.x - 1, facing: Math.PI / 2 },
    { x: table.x + 1, facing: -Math.PI / 2 },
  ];
  const z0 = 2;
  const z1 = layout.depth - 3;
  const len = z1 - z0 + 1;
  const tLen = table.z1 - table.z0 + 1;
  const barMid = at((bar[0]!.x + bar[1]!.x) / 2, bar[0]!.z);
  return (
    <group>
      {columns.map((c) => (
        <group key={c.x} position={at(c.x, (z0 + z1) / 2)} rotation-y={c.facing}>
          <mesh geometry={G.box} material={M.oak} position={[0, 0.05, -0.1]} scale={[len, 0.1, 0.66]} receiveShadow />
          <mesh geometry={G.box} material={M.fabric} position={[0, 0.12, -0.42]} scale={[len, 0.24, 0.06]} />
          {Array.from({ length: len }, (_, i) => (
            <mesh key={i} geometry={G.box} material={M.cushion} position={[-len / 2 + i + 0.5, SEAT_HEIGHT - 0.075, -0.08]} scale={[0.94, 0.15, 0.6]} castShadow receiveShadow />
          ))}
          <mesh geometry={G.box} material={M.fabric} position={[0, 0.48, -0.42]} scale={[len, 0.5, 0.16]} castShadow />
          {[-1, 1].map((sx) => (
            <mesh key={sx} geometry={G.box} material={M.fabric} position={[sx * (len / 2 + 0.08), 0.3, -0.12]} scale={[0.16, 0.42, 0.66]} castShadow />
          ))}
        </group>
      ))}
      <group position={at(table.x, (table.z0 + table.z1) / 2)}>
        <mesh geometry={G.box} material={M.oak} position={[0, 0.34, 0]} scale={[0.7, 0.04, tLen - 0.3]} castShadow receiveShadow />
        <mesh geometry={G.box} material={M.black} position={[0, 0.16, 0]} scale={[0.5, 0.32, tLen - 0.6]} />
        <mesh geometry={G.box} material={M.paper} position={[0.1, 0.37, -tLen / 4]} rotation-y={0.3} scale={[0.22, 0.02, 0.3]} />
        <group position={[0, 0.36, tLen / 4]} scale={0.45}>
          <PlantModel />
        </group>
      </group>
      {/* bancone del caffè contro la parete nord */}
      <group position={[barMid[0], 0, barMid[2] - 0.15]}>
        <mesh geometry={G.box} material={M.black} position={[0, 0.45, 0]} scale={[1.9, 0.9, 0.6]} castShadow receiveShadow />
        <mesh geometry={G.box} material={M.oak} position={[0, 0.92, 0]} scale={[1.96, 0.04, 0.64]} castShadow />
        <group position={[-0.4, 0.94, -0.05]}>
          <mesh geometry={G.box} material={M.chrome} position={[0, 0.2, 0]} scale={[0.36, 0.4, 0.34]} castShadow />
          <mesh geometry={G.box} material={M.black} position={[0, 0.12, 0.13]} scale={[0.22, 0.08, 0.1]} />
          <mesh geometry={G.box} material={M.lampLight} position={[0.1, 0.32, 0.172]} scale={[0.06, 0.03, 0.005]} />
        </group>
        {[0.15, 0.32, 0.5].map((x) => (
          <mesh key={x} geometry={G.cyl} material={M.paper} position={[x, 0.99, 0.05]} scale={[0.08, 0.1, 0.08]} />
        ))}
      </group>
    </group>
  );
}

function PlantModel(): ReactNode {
  return (
    <group>
      <mesh geometry={G.pot} material={M.pot} position={[0, 0.2, 0]} castShadow receiveShadow />
      <mesh geometry={G.leaf} material={M.leaf} position={[0, 0.65, 0]} scale={[1, 1.2, 1]} castShadow />
      <mesh geometry={G.leaf} material={M.leafDark} position={[0.14, 0.9, 0.05]} scale={0.65} castShadow />
      <mesh geometry={G.leaf} material={M.leafLight} position={[-0.12, 0.85, -0.08]} scale={0.55} castShadow />
    </group>
  );
}
