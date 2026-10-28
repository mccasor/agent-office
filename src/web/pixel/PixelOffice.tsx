import { useEffect, useMemo, useRef, useState } from 'react';
import type { Snapshot } from '../../shared/types';
import { StartQueue } from './motion';
import { arrivedAt, frameAt, isVisible, poseOf, stepMotion, type ActorMotion } from './actors';
import { cameraViewport, type Camera } from './camera';
import { AnimClock, nextWake } from './clock';
import {
  actorOps, actorRect, cellKey, furnitureOp, FLAT, feetOf, hitTest, inFront, sameFrame, sceneFurniture, sortByDepth,
  wallFaceVisible, type DrawOp, type HitRect, type SpriteRef, type Viewport,
} from './draw';
import { useSettings } from '../store';
import { actorTag, ALL_LABELS_ZOOM, drawLabel, labelTheme, officeShow, type ActorTag, type OfficeShow } from './labels';
import { litZones, RoomLights } from './lights';
import { EMPTY_PIXEL_SEATING, pixelModel } from './model';
import { createPlan } from './plan';
import { hobbySpotRoom } from './hobby';
import { officeBusy } from '../../shared/office';
import { furnitureLook, type FurnitureUse } from './screens';
import {
  alertImage, bossLook, bubbleImage, cachedImage, characterSprite, furnitureSprite, PALETTE, pickLook, selectionImage, shadowImage,
  tileSprite, toCanvas, type PixelLook, type Sprite, type SpriteCanvas,
} from './sprites';
import { TILE, type Furniture, type PixelActor, type PixelModel, type PixelPlan } from './types';
import { screenOf, useCamera } from './useCamera';
import { ZoomControls } from './ZoomControls';

/** animazioni semplici: 30 fotogrammi al secondo bastano */
const MAX_FPS = 30;

/** Quanto si disegna di una pianta e non cambia mai: arredi, luci, pavimento. Uno per pianta (createPlan le riusa). */
interface Scene {
  flat: Furniture[];
  solid: Furniture[];
  /** luci delle stanze (#99): accese con qualcuno dentro, penombra altrimenti */
  lights: RoomLights;
  floor: SpriteCanvas | null;
}
const scenes = new WeakMap<PixelPlan, Scene>();
function sceneOf(plan: PixelPlan): Scene {
  let scene = scenes.get(plan);
  if (!scene) {
    const furniture = sceneFurniture(plan);
    scene = { flat: furniture.filter((f) => FLAT.has(f.kind)), solid: furniture.filter((f) => !FLAT.has(f.kind)), lights: new RoomLights(plan), floor: null };
    scenes.set(plan, scene);
  }
  return scene;
}

/** Pavimenti, pareti, porte e arredi piatti non cambiano mai: disegnati una volta in una canvas a scala 1. */
function floorLayer(plan: PixelPlan, scene: Scene): SpriteCanvas {
  if (scene.floor) return scene.floor;
  const { w, h } = { w: plan.width * TILE, h: plan.depth * TILE };
  const canvas = toCanvas({ w, h, data: new Uint8ClampedArray(w * h * 4), ax: 0, ay: 0 });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (ctx) {
    for (let z = 0; z < plan.depth; z++) {
      for (let x = 0; x < plan.width; x++) {
        const kind = plan.tiles[z]![x]!;
        const s = tileSprite(kind, x, z, kind === 'wall' && wallFaceVisible(plan, x, z), plan.styles[z]![x]!);
        ctx.drawImage(s.canvas, x * TILE - s.ax, z * TILE - s.ay);
      }
    }
    for (const f of scene.flat) {
      const s = furnitureSprite(f.kind, f.facing, f.w, f.h, 0, f.variant);
      ctx.drawImage(s.canvas, f.cell.x * TILE - s.ax, f.cell.z * TILE - s.ay);
    }
  }
  scene.floor = canvas;
  return canvas;
}

const spriteOf = (ref: SpriteRef): Sprite => {
  switch (ref.type) {
    case 'furniture': return furnitureSprite(ref.kind, ref.facing, ref.w, ref.h, ref.frame, ref.variant);
    case 'character': return characterSprite(ref.look, ref.pose, ref.facing, ref.frame);
    case 'shadow': return cachedImage('x:shadow', shadowImage);
    case 'selection': return cachedImage('x:selection', selectionImage);
  }
};

/** seme stabile per sfasare le animazioni dei personaggi */
function seedOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function lookOf(actor: PixelActor, model: PixelModel): PixelLook {
  if (!actor.boss) return pickLook(actor.id);
  const room = model.rooms[actor.sessionId];
  // la giacca segue la stanza; chi non ce l'ha prende un colore dopo quelli delle stanze
  const work = model.plan.rooms.filter((r) => r.kind === 'instance').length;
  return bossLook(room ?? work + Math.max(0, model.roomless.indexOf(actor.sessionId)));
}

interface Entry {
  actor: PixelActor;
  motion: ActorMotion;
}

interface Live {
  model: PixelModel;
  selectedId: string | null;
  /** voci delle impostazioni (#94): nomi, ruolo, fumetti e avvisi */
  show: OfficeShow;
}

interface Sim {
  /** pianta dei movimenti in corso: se cambia composizione si riparte, ognuno già al suo posto */
  plan: PixelPlan | null;
  entries: Map<string, Entry>;
  queue: StartQueue;
  /** primo fotogramma: chi ha già un posto ci compare seduto, senza rientrare dalla porta */
  fresh: boolean;
  rects: HitRect[];
  view: Viewport;
  /** quanto è finito sul canvas all'ultimo disegno (vedi sameFrame) */
  frame: unknown[] | null;
}

/**
 * Ufficio 2D in pixel art (#71): canvas a tutta finestra sotto l'HUD, a scala intera. Lo stato di movimento vive in
 * un ref e si aggiorna in un loop requestAnimationFrame limitato a MAX_FPS, fermo quando `active` è falso. Quando
 * niente si muove il loop dorme fino al prossimo scatto delle animazioni (nextWake) o fino a uno snapshot, un
 * cambio di selezione, camera, dimensioni, tema o impostazioni.
 */
export function PixelOffice({ snapshot, selectedId, onSelect, active }: {
  snapshot: Snapshot | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** vista mostrata e pagina visibile: altrimenti il loop è fermo */
  active: boolean;
}) {
  // composizione dell'ufficio (#108): una nuova vale solo quando nessuno sta lavorando (chi modifica config.json a
  // mano scavalca il blocco delle Impostazioni); intanto resta la vecchia
  const settings = useSettings();
  const wanted = settings.office.rooms;
  // posti ricalcolati solo a ogni nuovo snapshot o pianta, partendo dai precedenti (posti stabili)
  const [state, setState] = useState(() => {
    const plan = createPlan(wanted);
    return { snapshot, plan, model: pixelModel(snapshot, EMPTY_PIXEL_SEATING, plan) };
  });
  const next = createPlan(wanted);
  const plan = next !== state.plan && officeBusy(snapshot?.sessions ?? []) ? state.plan : next;
  if (state.snapshot !== snapshot || state.plan !== plan) setState({ snapshot, plan, model: pixelModel(snapshot, state.model, plan) });
  const { model } = state;

  const canvas = useRef<HTMLCanvasElement>(null);
  const sim = useRef<Sim>({ plan: null, entries: new Map(), queue: new StartQueue(), fresh: true, rects: [], view: { scale: 1, ox: 0, oy: 0 }, frame: null });
  // zoom e trascinamento (#87); un clic senza trascinamento seleziona il personaggio sotto il puntatore
  const { camera, cameraRef, handlers, dragging, controls } = useCamera(canvas, model.plan, {
    pick: (x, y) => hitTest(sim.current.rects, x, y),
    onSelect,
  });
  // stesse preferenze, stesso oggetto (share nello store): si ricalcola e si risveglia solo a un cambio vero
  const show = useMemo(() => officeShow(settings), [settings]);
  const live = useRef<Live>({ model, selectedId, show });
  /** risveglia il loop addormentato (no-op se gira già o se la vista è ferma) */
  const wake = useRef(() => {});
  useEffect(() => {
    live.current = { model, selectedId, show };
    wake.current();
  }, [model, selectedId, show]);
  // zoom e trascinamento: la camera nuova è già in cameraRef
  useEffect(() => wake.current(), [camera]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx || !active) return;
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = -Infinity;
    let prevTime: number | null = null;
    /** scatto (s) per cui il timer ha svegliato il loop: il vsync che segue può avere un istante appena precedente */
    let due = 0;

    const frame = (t: number) => {
      raf = 0;
      // tolleranza di 2 ms: a 60 Hz un frame sì e uno no anche con piccole irregolarità del vsync
      if (t - last < 1000 / MAX_FPS - 2) {
        raf = requestAnimationFrame(frame);
        return;
      }
      last = t;
      const now = Math.max(t / 1000, due);
      due = 0;
      const dt = prevTime === null ? 0 : now - prevTime;
      const at = render(el, ctx, sim.current, live.current, cameraRef.current, now, dt);
      if (at <= now) {
        prevTime = now;
        raf = requestAnimationFrame(frame);
        return;
      }
      // fermo: nessuno cammina, quindi al risveglio non c'è tempo da recuperare
      prevTime = null;
      if (Number.isFinite(at)) {
        timer = setTimeout(() => {
          start();
          due = at;
        }, (at - performance.now() / 1000) * 1000);
      }
    };
    const start = () => {
      clearTimeout(timer);
      timer = undefined;
      if (!raf) raf = requestAnimationFrame(frame);
    };
    wake.current = start;
    // dimensioni (anche il dpr, spostando la finestra tra schermi) e tema chiaro/scuro cambiano il disegno
    const scheme = window.matchMedia?.('(prefers-color-scheme: dark)');
    window.addEventListener('resize', start);
    scheme?.addEventListener?.('change', start);
    start();
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      wake.current = () => {};
      window.removeEventListener('resize', start);
      scheme?.removeEventListener?.('change', start);
    };
  }, [active, cameraRef]);

  return (
    <>
      <canvas ref={canvas} className={`pixel-office${dragging ? ' pixel-office--dragging' : ''}`} {...handlers} />
      <ZoomControls {...controls} />
    </>
  );
}

/** aggiorna i movimenti e disegna un fotogramma; restituisce quando ridisegnare (vedi nextWake) */
function render(
  el: HTMLCanvasElement, ctx: CanvasRenderingContext2D, s: Sim, live: Live, camera: Camera, now: number, dt: number,
): number {
  const { model, selectedId, show } = live;
  const { plan } = model;
  const scene = sceneOf(plan);
  const { lights } = scene;
  // pianta nuova (#108): movimenti dimenticati, chi ha un posto ci ricompare seduto
  if (s.plan !== plan) {
    s.plan = plan;
    s.entries.clear();
    s.queue = new StartQueue();
    s.fresh = true;
    s.frame = null;
  }

  // backing store in pixel fisici
  const surface = screenOf(el);
  const { w: bw, h: bh, dpr } = surface;
  if (el.width !== bw || el.height !== bh) {
    el.width = bw;
    el.height = bh;
  }
  const view = cameraViewport(camera, surface, plan);
  s.view = view;

  // movimenti: chi sparisce dallo snapshot esce dalla porta con l'ultimo stato noto, poi viene dimenticato
  const seen = new Set<string>();
  for (const actor of model.actors) {
    seen.add(actor.id);
    const prev = s.entries.get(actor.id);
    const motion = s.fresh && !prev && actor.target
      ? arrivedAt(actor.target, now)
      : stepMotion(prev?.motion, actor.target, plan, now, dt, s.queue);
    s.entries.set(actor.id, { actor, motion });
  }
  for (const [id, e] of s.entries) {
    if (seen.has(id)) continue;
    e.motion = stepMotion(e.motion, null, plan, now, dt, s.queue);
    if (e.motion.phase === 'gone') s.entries.delete(id);
  }
  s.fresh = false;
  // pose, schermi e biliardino avanzano a scatti comuni; camminate e luci restano fluide
  const clock = new AnimClock(now);
  let smooth = false;

  // chi digita alla propria scrivania accende il monitor che ha davanti (a tema col ruolo), chi gioca il biliardino
  const ops: DrawOp[] = [];
  const rects: HitRect[] = [];
  const use: FurnitureUse = { screens: new Map(), players: new Map(), gamers: new Map(), pong: new Map() };
  const tags: (ActorTag & { actor: PixelActor; x: number; y: number })[] = [];
  // ingrandita abbastanza c'è posto per il nome di tutti (compatto, senza ruolo); altrimenti boss, bloccati e selezionato
  const everyone = view.scale / dpr >= ALL_LABELS_ZOOM;
  for (const e of s.entries.values()) {
    // in cammino o in fila alla porta per entrare
    if (e.motion.phase === 'walking' || e.motion.phase === 'queued') smooth = true;
    if (!isVisible(e.motion)) continue;
    const pose = poseOf(e.actor, e.motion);
    if (pose === 'type' && e.motion.at) use.screens.set(cellKey(inFront(e.motion.at)), e.actor.agent.area);
    if ((pose === 'play' || pose === 'game' || pose === 'paddle') && e.motion.at) {
      // biliardino, TV e tavolo da ping-pong si animano per sala: la stanza è nell'id del posto (hobby.ts)
      const room = hobbySpotRoom(e.motion.at.id);
      const counts = pose === 'play' ? use.players : pose === 'game' ? use.gamers : use.pong;
      if (room !== null) counts.set(room, (counts.get(room) ?? 0) + 1);
    }
    const selected = e.actor.id === selectedId;
    ops.push(...actorOps({
      id: e.actor.id, pos: e.motion.pos, look: lookOf(e.actor, model), pose, facing: e.motion.facing,
      frame: frameAt(pose, clock, seedOf(e.actor.id)), selected,
    }));
    rects.push(actorRect(e.actor.id, e.motion.pos));
    const tag = actorTag(e.actor, selected, everyone, show);
    if (tag) tags.push({ ...tag, actor: e.actor, ...feetOf(e.motion.pos) });
  }
  // luci (#99): zone accese da chi c'è adesso; nelle stanze spente i monitor sono spenti
  const occupants = [...s.entries.values()].filter((e) => isVisible(e.motion)).map((e) => ({ sessionId: e.actor.sessionId, pos: e.motion.pos }));
  lights.update(litZones(lights.geometry, occupants, model.rooms, new Set(model.idle)), now);
  lights.dimScreens(use.screens);
  for (const f of scene.solid) {
    const { frame, variant } = furnitureLook(f, use, clock);
    ops.push(furnitureOp(f, frame, variant));
  }
  s.rects = rects;

  // sopra a tutto: fumetti di chi è bloccato ed etichette; quelle in evidenza per ultime, sopra alle altre
  const rank = ({ actor }: { actor: PixelActor }) =>
    (actor.id === selectedId ? 3 : actor.waiting || (actor.alert && show.alerts) ? 2 : actor.boss ? 1 : 0);
  tags.sort((a, b) => rank(a) - rank(b));
  const sprites = sortByDepth(ops).map((op) => ({ sprite: spriteOf(op.sprite), x: op.x, y: op.y }));

  // fotogramma identico al precedente (nessuno cammina, animazioni ferme tra due pose): niente da ridisegnare
  const theme = labelTheme();
  const frame: unknown[] = [bw, bh, dpr, view.scale, view.ox, view.oy, theme];
  for (const d of sprites) frame.push(d.sprite, d.x, d.y);
  for (const { spec, x, y, mark } of tags) frame.push(spec?.text, spec?.area, spec?.selected, spec?.waiting, mark, x, y);
  // le luci in transizione cambiano il fotogramma anche se nessuno si muove
  frame.push(...lights.levels);
  const wakeAt = nextWake(now, smooth || lights.busy(now), clock);
  if (sameFrame(s.frame, frame)) return wakeAt;
  s.frame = frame;

  // disegno a scala intera: tutto allineato alla griglia dei pixel fisici
  const k = view.scale;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = PALETTE.void;
  ctx.fillRect(0, 0, bw, bh);
  const floor = floorLayer(plan, scene);
  ctx.drawImage(floor, view.ox, view.oy, floor.width * k, floor.height * k);
  const blit = (sp: Sprite, x: number, y: number) =>
    ctx.drawImage(sp.canvas, view.ox + (x - sp.ax) * k, view.oy + (y - sp.ay) * k, sp.w * k, sp.h * k);
  for (const d of sprites) blit(d.sprite, d.x, d.y);
  lights.draw(ctx, view);

  const bubbles = { waiting: cachedImage('x:bubble', () => bubbleImage()), alert: cachedImage('x:alert', alertImage) };
  for (const { spec, x, y, mark } of tags) {
    let top = y - 21;
    if (mark) {
      const bubble = bubbles[mark];
      blit(bubble, x, top - 2);
      top -= bubble.h + 1;
    }
    if (spec) drawLabel(ctx, spec, view.ox + x * view.scale, view.oy + top * view.scale, dpr, theme);
  }
  return wakeAt;
}
