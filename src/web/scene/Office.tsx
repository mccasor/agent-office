import { useMemo, type ReactNode } from 'react';
import { BOSS_W, cellToWorld, deskCells, LOUNGE_W, plantCells, type OfficeLayout } from './layout';
import { BAKED, bake, part, rbox } from './clay';
import { C, CHAIR, PLANT, PLANTER } from './furniture';
import { BackWallDecor, BossGlass, BossOffice, DeskModel, Door, Lounge, SlatScreen, useDisposable, Wall, wallSegments } from './rooms';

/* Composizione dell'ufficio: luci, pavimento e stanze (./rooms) con gli arredi (./furniture) disposti sul layout. */

/** Ufficio: stanza del boss, openspace a isole con fioriere, area relax, pareti a doghe e vetrate, luci. */
export function Office({ layout }: { layout: OfficeLayout }): ReactNode {
  const desks = useMemo(() => deskCells(layout), [layout]);
  const plants = useMemo(() => plantCells(layout), [layout]);
  const walls = useMemo(() => wallSegments(layout), [layout]);
  const { width: w, depth: d } = layout;
  const span = Math.max(w, d);
  const at = (x: number, z: number) => cellToWorld(layout, { x, z });
  const [x0w, , z0w] = at(0, 0);
  const floor = useDisposable(useMemo(() => {
    const [bx, , bz] = cellToWorld(layout, { x: (1 + BOSS_W) / 2, z: (d - 1) / 2 });
    const bossRug = cellToWorld(layout, { x: (1 + BOSS_W) / 2, z: 4 });
    const loungeRug = cellToWorld(layout, { x: w - 1 - LOUNGE_W + 2, z: (d - 1) / 2 });
    return bake([
      part(rbox(w + 0.2, 0.24, d + 0.2, 0.1, 4), C.base, [0, -0.12, 0]),
      part(rbox(w - 1, 0.004, d - 1, 0.0019), C.carpet, [0, 0.002, 0]),
      part(rbox(BOSS_W + 0.5, 0.006, d - 1, 0.0029), C.parquet, [bx, 0.005, bz]),
      // tappeti morbidi, con bordo arrotondato
      part(rbox(BOSS_W - 0.8, 0.01, 5, 0.0049, 3), C.bossRug, [bossRug[0], 0.009, bossRug[2]]),
      part(rbox(LOUNGE_W - 1.2, 0.01, d - 2.4, 0.0049, 3), C.rug, [loungeRug[0], 0.009, loungeRug[2]]),
    ]);
  }, [layout, w, d]));

  return (
    <group>
      {/* luce calda e morbida: cielo/terra caldi, sole con ombre sfumate, controluce tenue che schiarisce le ombre */}
      <hemisphereLight args={['#fff6ea', '#c9b9a3', 1.15]} />
      <ambientLight color="#ffe9d8" intensity={0.12} />
      <directionalLight
        position={[span * 0.45, span * 0.9, span * 0.35]}
        color="#fff4e4"
        intensity={1.45}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-radius={6}
        shadow-camera-left={-span * 0.8}
        shadow-camera-right={span * 0.8}
        shadow-camera-top={span * 0.8}
        shadow-camera-bottom={-span * 0.8}
        shadow-camera-near={0.5}
        shadow-camera-far={span * 3}
      />
      <directionalLight position={[-span * 0.6, span * 0.5, -span * 0.15]} color="#ffe6d2" intensity={0.3} />

      {/* basamento bianco, moquette dell'openspace, parquet del boss, tappeti (una geometria sola) */}
      <mesh geometry={floor} material={BAKED} receiveShadow />

      {walls.map((s, i) => (
        <Wall key={i} segment={s} />
      ))}
      <BackWallDecor layout={layout} x0={x0w} z0={z0w} />
      <BossGlass layout={layout} />
      <Door layout={layout} />

      {layout.islands.map((c) => (
        <group key={`${c.x},${c.z}`} position={at(c.x + 0.5, c.z + 1.5)}>
          <mesh geometry={PLANTER} material={BAKED} castShadow receiveShadow />
        </group>
      ))}
      {desks.map((desk) => (
        <group key={desk.seatId} position={at(desk.cell.x, desk.cell.z)} rotation-y={desk.facing}>
          <DeskModel />
        </group>
      ))}
      {layout.seats.map((s) => (
        <group key={s.id} position={at(s.cell.x, s.cell.z)} rotation-y={s.facing}>
          <mesh geometry={CHAIR} material={BAKED} castShadow receiveShadow />
        </group>
      ))}

      {/* divisori bassi tra blocchi di scrivanie (compaiono quando l'ufficio raddoppia) */}
      {layout.dividers.map((dv) => {
        const [, , za] = at(dv.x, dv.z0 - 0.5);
        const [xd, , zb] = at(dv.x, dv.z1 + 0.5);
        return (
          <group key={dv.x} position={[xd, 0, (za + zb) / 2]}>
            <SlatScreen length={zb - za} height={0.8} />
          </group>
        );
      })}

      <BossOffice layout={layout} />
      <Lounge layout={layout} />

      {plants.map((p, i) => (
        <group key={i} position={at(p.x, p.z)} rotation-y={i * 1.3}>
          <mesh geometry={PLANT} material={BAKED} castShadow receiveShadow />
        </group>
      ))}
    </group>
  );
}
