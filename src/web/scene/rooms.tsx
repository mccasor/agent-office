import { useEffect, useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cellToWorld, loungePlan, type OfficeLayout } from './layout';
import { BAKED, bake, capsule, clay, part, rbox } from './clay';
import {
  ARMCHAIR, BAR, BAR_INDICATOR, BOSS_CHAIR, BOSS_DESK, BOSS_LAMP_X, BOSS_MONITORS, BOSS_SHELF, BOSS_STATUE, C, DESK,
  DESK_BULB, DESK_SCREEN, DESK_TOP_Y, DOOR_MAT, DOOR_POST, FLOOR_LAMP, FRONT_WALL_H, G, GLASS_H, HALF_PI, LAMP_BULB,
  LOUNGE_SHELF, LOUNGE_TABLE, LOVESEAT, M, PAINTING, PILASTER, SCREEN_AT, WALL_H, WALL_T, hedgeParts, mossTexture,
  slatTexture,
} from './furniture';

/* Stanze e pezzi dipendenti dal layout: pareti, porta, vetrata e postazioni del boss, area relax, paraventi. */

/** Libera la geometria (dipendente dal layout, creata con useMemo) quando viene sostituita o smontata. */
export function useDisposable<T extends THREE.BufferGeometry>(g: T): T {
  useEffect(() => () => g.dispose(), [g]);
  return g;
}

export interface WallSegment { position: [number, number, number]; size: [number, number]; height: number; slats: boolean }

/** Pareti sulle celle perimetrali (spessore WALL_T al centro della cella), parete sud interrotta dalla porta. */
export function wallSegments(layout: OfficeLayout): WallSegment[] {
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

/** Parete con spigoli arrotondati e cimasa bombata. */
export function Wall({ segment: s }: { segment: WallSegment }): ReactNode {
  const material = useMemo(() => {
    const map = s.slats ? slatTexture(Math.max(s.size[0], s.size[1])) : null;
    return map ? clay('#ffffff', { map }) : M.base;
  }, [s]);
  const body = useDisposable(useMemo(() => rbox(s.size[0], s.height, s.size[1], 0.06, 3), [s]));
  const cap = useDisposable(useMemo(() => rbox(s.size[0] + 0.04, 0.07, s.size[1] + 0.04, 0.034, 3), [s]));
  return (
    <group position={s.position}>
      <mesh geometry={body} material={material} position={[0, s.height / 2, 0]} castShadow receiveShadow />
      <mesh geometry={cap} material={M.base} position={[0, s.height + 0.02, 0]} castShadow />
    </group>
  );
}

/** Lesena scura sulla parete di fondo, quadro e libreria nella stanza del boss, parete di muschio dell'area relax. */
export function BackWallDecor({ layout, x0, z0 }: { layout: OfficeLayout; x0: number; z0: number }): ReactNode {
  const face = z0 + WALL_T / 2 + 0.02;
  const westFace = x0 + WALL_T / 2 + 0.02;
  const pilasters = [cellToWorld(layout, layout.bossDoor)[0]];
  const lounge = loungePlan(layout);
  const [mossX0] = cellToWorld(layout, { x: lounge.screenX, z: 0 });
  const [mossX1] = cellToWorld(layout, { x: layout.width - 1, z: 0 });
  const mossLen = mossX1 - mossX0 - WALL_T / 2;
  return (
    <group>
      <MossWall position={[mossX0 + mossLen / 2, 0, face]} length={mossLen} />
      {pilasters.map((x) => (
        <mesh key={x} geometry={PILASTER} material={M.black} position={[x, WALL_H / 2, face]} />
      ))}
      {/* stanza del boss: quadro sulla parete ovest, libreria sulla parete nord */}
      <mesh geometry={PAINTING} material={BAKED} position={[westFace, 1.35, cellToWorld(layout, { x: 0, z: 5 })[2]]} />
      <mesh geometry={BOSS_SHELF} material={BAKED} position={[cellToWorld(layout, { x: 3, z: 0 })[0], 0, face + 0.15]} castShadow receiveShadow />
    </group>
  );
}

/** Vetrata con montanti neri arrotondati lungo la colonna BOSS_W + 1, aperta in corrispondenza di bossDoor. */
export function BossGlass({ layout }: { layout: OfficeLayout }): ReactNode {
  const x = cellToWorld(layout, layout.bossDoor)[0];
  const panes = useMemo((): [number, number][] => {
    const z = (cz: number) => cellToWorld(layout, { x: 0, z: cz })[2];
    return [[z(0.5), z(layout.bossDoor.z - 0.5)], [z(layout.bossDoor.z + 0.5), z(layout.depth - 1.5)]];
  }, [layout]);
  const frame = useDisposable(useMemo(() => bake(panes.flatMap(([a, b]) => {
    const n = Math.round(b - a);
    return [
      part(rbox(0.07, 0.055, b - a, 0.026), C.black, [0, GLASS_H, (a + b) / 2]),
      part(rbox(0.07, 0.07, b - a, 0.03), C.black, [0, 0.035, (a + b) / 2]),
      ...Array.from({ length: n + 1 }, (_, i) => part(rbox(0.06, GLASS_H, 0.06, 0.028), C.black, [0, GLASS_H / 2, a + i * ((b - a) / n)])),
    ];
  })), [panes]));
  const glass = useDisposable(useMemo(
    () => mergeGeometries(panes.map(([a, b]) => rbox(0.04, GLASS_H, b - a, 0.018).translate(0, GLASS_H / 2, (a + b) / 2))),
    [panes],
  ));
  return (
    <group position={[x, 0, 0]}>
      <mesh geometry={glass} material={M.glass} />
      <mesh geometry={frame} material={BAKED} castShadow />
    </group>
  );
}

/** Porta d'ingresso nella parete sud: zerbino e stipiti. */
export function Door({ layout }: { layout: OfficeLayout }): ReactNode {
  const [x, , z] = cellToWorld(layout, layout.door);
  return (
    <group position={[x, 0, z]}>
      <mesh geometry={DOOR_MAT} material={M.door} position={[0, 0.012, -0.5]} receiveShadow />
      {[-0.5, 0.5].map((dx) => (
        <mesh key={dx} geometry={DOOR_POST} material={M.black} position={[dx, (FRONT_WALL_H + 0.45) / 2, 0]} castShadow />
      ))}
    </group>
  );
}
/** Scrivania cotta + schermo e bulbo della lampada luminosi. */
export function DeskModel(): ReactNode {
  return (
    <group>
      <mesh geometry={DESK} material={BAKED} castShadow receiveShadow />
      <mesh geometry={G.screen} material={M.screen} position={DESK_SCREEN} />
      <mesh geometry={G.bulb} material={M.lampLight} position={DESK_BULB} />
    </group>
  );
}

/**
 * Stanza del boss: una postazione per sessione di Claude attiva (scrivania in noce con due monitor, poltrona in pelle,
 * targhetta dorata); la statuetta dorata sta sulla prima.
 */
export function BossOffice({ layout }: { layout: OfficeLayout }): ReactNode {
  const at = (x: number, z: number) => cellToWorld(layout, { x, z });
  return (
    <group>
      {layout.bossSeats.map((seat, i) => (
        <group key={seat.id}>
          <group position={at(seat.cell.x, seat.cell.z + 1)} rotation-y={seat.facing + Math.PI}>
            <mesh geometry={BOSS_DESK} material={BAKED} castShadow receiveShadow />
            {i === 0 && <mesh geometry={BOSS_STATUE} material={BAKED} castShadow />}
            {BOSS_MONITORS.map(({ p, ry }) => (
              <group key={p[0]} position={p} rotation-y={ry}>
                <mesh geometry={G.screen} material={M.screen} position={SCREEN_AT} />
              </group>
            ))}
            <mesh geometry={G.bulb} material={M.lampLight} position={[BOSS_LAMP_X + LAMP_BULB[0], DESK_TOP_Y + LAMP_BULB[1], -0.1 + LAMP_BULB[2]]} />
          </group>
          <group position={at(seat.cell.x, seat.cell.z)} rotation-y={seat.facing}>
            <mesh geometry={BOSS_CHAIR} material={BAKED} castShadow receiveShadow />
          </group>
        </group>
      ))}
    </group>
  );
}

/** Pannello di muschio con bordi morbidi e cimasa in rovere, sulla parete nord dell'area relax. */
function MossWall({ position, length }: { position: [number, number, number]; length: number }): ReactNode {
  const material = useMemo(() => {
    const map = mossTexture(length);
    return map ? clay('#ffffff', { map, roughness: 1 }) : M.leafDark;
  }, [length]);
  const panel = useDisposable(useMemo(() => rbox(length, WALL_H - 0.04, 0.07, 0.03, 3), [length]));
  const cap = useDisposable(useMemo(() => rbox(length, 0.05, 0.11, 0.024, 3), [length]));
  return (
    <group position={position}>
      <mesh geometry={panel} material={material} position={[0, WALL_H / 2, 0.035]} receiveShadow />
      <mesh geometry={cap} material={M.oak} position={[0, WALL_H - 0.01, 0.055]} />
    </group>
  );
}

/**
 * Paravento lungo l'asse z locale (separè dell'area relax, divisori tra blocchi di scrivanie): fioriera bassa con siepe
 * a bolle e doghe verticali di rovere arrotondate alte `height`, tutto in una geometria.
 */
export function SlatScreen({ length, height = 1.3 }: { length: number; height?: number }): ReactNode {
  const geometry = useDisposable(useMemo(() => {
    const slats = Math.round(length / 0.14);
    const hedge = hedgeParts(length, 0.45, 0.42).map((p) => ({ ...p, m: new THREE.Matrix4().makeRotationY(HALF_PI).multiply(p.m) }));
    return bake([
      part(rbox(0.4, 0.4, length, 0.07, 3), C.black, [0, 0.2, 0]),
      ...hedge,
      ...Array.from({ length: slats }, (_, i) => part(capsule(0.03, height + 0.02, 8), C.oak, [0, 0.41 + height / 2, -length / 2 + (i + 0.5) * (length / slats)])),
      part(rbox(0.1, 0.05, length, 0.024, 3), C.oak, [0, 0.42 + height, 0]),
    ]);
  }, [length, height]));
  return <mesh geometry={geometry} material={BAKED} castShadow receiveShadow />;
}

/**
 * Area relax: separè in doghe di rovere con fioriera alla base, salottini (due poltroncine, tavolino, divanetto),
 * libreria, bancone con la macchina del caffè, lampada da terra.
 */
export function Lounge({ layout }: { layout: OfficeLayout }): ReactNode {
  const plan = loungePlan(layout);
  const at = (x: number, z: number) => cellToWorld(layout, { x, z });
  const [sx, , sz0] = at(plan.screenX, 0.5);
  const [, , sz1] = at(plan.screenX, plan.screenZ1 + 0.5);
  const barMid = at((plan.bar[0]!.x + plan.bar[1]!.x) / 2, 1);
  return (
    <group>
      <group position={[sx, 0, (sz0 + sz1) / 2]}>
        <SlatScreen length={sz1 - sz0} />
      </group>

      {plan.nooks.map(({ z0 }) => {
        const [tx, , tz] = at(plan.tableX, z0 + 0.5);
        return (
          <group key={z0}>
            <mesh geometry={LOUNGE_TABLE} material={BAKED} position={[tx, 0, tz]} castShadow receiveShadow />
            {/* due poltroncine a ovest */}
            {[z0, z0 + 1].map((z) => (
              <group key={z} position={at(plan.tableX - 1, z)} rotation-y={Math.PI / 2}>
                <mesh geometry={ARMCHAIR} material={BAKED} castShadow receiveShadow />
              </group>
            ))}
            {/* divanetto a due posti a est */}
            <group position={at(plan.tableX + 1, z0 + 0.5)} rotation-y={-Math.PI / 2}>
              <mesh geometry={LOVESEAT} material={BAKED} castShadow receiveShadow />
            </group>
          </group>
        );
      })}

      {/* libreria contro la parete nord */}
      <mesh geometry={LOUNGE_SHELF} material={BAKED} position={[at(plan.shelf.x, 0)[0], 0, at(0, 0)[2] + WALL_T / 2 + 0.2]} castShadow receiveShadow />

      {/* bancone del caffè contro la parete nord */}
      <group position={[barMid[0], 0, barMid[2] - 0.15]}>
        <mesh geometry={BAR} material={BAKED} castShadow receiveShadow />
        <mesh geometry={G.indicator} material={M.lampLight} position={BAR_INDICATOR} />
      </group>

      {/* lampada da terra nell'angolo sud-est */}
      <group position={at(layout.width - 2, layout.depth - 3)}>
        <mesh geometry={FLOOR_LAMP} material={BAKED} position={[0.3, 0, 0.3]} castShadow />
        <mesh geometry={G.floorShade} material={M.lampLight} position={[0.3, 1.56, 0.3]} />
      </group>
    </group>
  );
}
