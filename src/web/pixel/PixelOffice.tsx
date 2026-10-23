import { useEffect, useRef, useState } from 'react';
import type { Snapshot } from '../../shared/types';
import { StartQueue } from './motion';
import { arrivedAt, frameAt, isVisible, poseOf, stepMotion, type ActorMotion } from './actors';
import { agentName } from '../hud/labels';
import { cameraViewport, type Camera } from './camera';
import {
  actorOps, actorRect, cellKey, furnitureOp, FLAT, feetOf, hitTest, inFront, sceneFurniture, sortByDepth,
  wallFaceVisible, type DrawOp, type HitRect, type SpriteRef, type Viewport,
} from './draw';
import { ALL_LABELS_ZOOM, drawLabel, labelText } from './labels';
import { EMPTY_PIXEL_SEATING, pixelModel } from './model';
import { createPlan } from './plan';
import { furnitureLook, type FurnitureUse } from './screens';
import {
  bossLook, bubbleImage, cachedImage, characterSprite, furnitureSprite, PALETTE, pickLook, selectionImage, shadowImage,
  tileSprite, toCanvas, type PixelLook, type Sprite, type SpriteCanvas,
} from './sprites';
import { TILE, type PixelActor, type PixelModel } from './types';
import { screenOf, useCamera } from './useCamera';
import { ZoomControls } from './ZoomControls';

/** animazioni semplici: 30 fotogrammi al secondo bastano */
const MAX_FPS = 30;

const plan = createPlan();
const furniture = sceneFurniture(plan);
const flat = furniture.filter((f) => FLAT.has(f.kind));
const solid = furniture.filter((f) => !FLAT.has(f.kind));

/** Pavimenti, pareti, porte e arredi piatti non cambiano mai: disegnati una volta in una canvas a scala 1. */
let floorCanvas: SpriteCanvas | null = null;
function floorLayer(): SpriteCanvas {
  if (floorCanvas) return floorCanvas;
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
    for (const f of flat) {
      const s = furnitureSprite(f.kind, f.facing, f.w, f.h, 0, f.variant);
      ctx.drawImage(s.canvas, f.cell.x * TILE - s.ax, f.cell.z * TILE - s.ay);
    }
  }
  floorCanvas = canvas;
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
  return bossLook(room ?? 5 + Math.max(0, model.roomless.indexOf(actor.sessionId)));
}

interface Entry {
  actor: PixelActor;
  motion: ActorMotion;
}

interface Live {
  model: PixelModel;
  selectedId: string | null;
}

interface Sim {
  entries: Map<string, Entry>;
  queue: StartQueue;
  /** primo fotogramma: chi ha già un posto ci compare seduto, senza rientrare dalla porta */
  fresh: boolean;
  rects: HitRect[];
  view: Viewport;
}

/**
 * Ufficio 2D in pixel art (#71): canvas a tutta finestra sotto l'HUD, a scala intera. Lo stato di movimento vive in
 * un ref e si aggiorna in un loop requestAnimationFrame limitato a MAX_FPS, fermo quando `active` è falso.
 */
export function PixelOffice({ snapshot, selectedId, onSelect, active }: {
  snapshot: Snapshot | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** vista mostrata e pagina visibile: altrimenti il loop è fermo */
  active: boolean;
}) {
  // posti ricalcolati solo a ogni nuovo snapshot, partendo dai precedenti (posti stabili)
  const [state, setState] = useState(() => ({ snapshot, model: pixelModel(snapshot, EMPTY_PIXEL_SEATING) }));
  if (state.snapshot !== snapshot) setState({ snapshot, model: pixelModel(snapshot, state.model) });
  const { model } = state;

  const canvas = useRef<HTMLCanvasElement>(null);
  const sim = useRef<Sim>({ entries: new Map(), queue: new StartQueue(), fresh: true, rects: [], view: { scale: 1, ox: 0, oy: 0 } });
  // zoom e trascinamento (#87); un clic senza trascinamento seleziona il personaggio sotto il puntatore
  const { cameraRef, handlers, dragging, controls } = useCamera(canvas, plan, {
    pick: (x, y) => hitTest(sim.current.rects, x, y),
    onSelect,
  });
  const live = useRef<Live>({ model, selectedId });
  useEffect(() => {
    live.current = { model, selectedId };
  }, [model, selectedId]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx || !active) return;
    let raf = 0;
    let last = -Infinity;
    let prevTime: number | null = null;

    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      // tolleranza di 2 ms: a 60 Hz un frame sì e uno no anche con piccole irregolarità del vsync
      if (t - last < 1000 / MAX_FPS - 2) return;
      last = t;
      const now = t / 1000;
      const dt = prevTime === null ? 0 : now - prevTime;
      prevTime = now;
      render(el, ctx, sim.current, live.current, cameraRef.current, now, dt);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [active, cameraRef]);

  return (
    <>
      <canvas ref={canvas} className={`pixel-office${dragging ? ' pixel-office--dragging' : ''}`} {...handlers} />
      <ZoomControls {...controls} />
    </>
  );
}

/** aggiorna i movimenti e disegna un fotogramma */
function render(
  el: HTMLCanvasElement, ctx: CanvasRenderingContext2D, s: Sim, live: Live, camera: Camera, now: number, dt: number,
): void {
  const { model, selectedId } = live;

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

  // chi digita alla propria scrivania accende il monitor che ha davanti (a tema col ruolo), chi gioca il biliardino
  const ops: DrawOp[] = [];
  const rects: HitRect[] = [];
  const use: FurnitureUse = { screens: new Map(), players: 0 };
  const labels: { entry: Entry; x: number; y: number }[] = [];
  // ingrandita abbastanza c'è posto per il nome di tutti (compatto, senza ruolo); altrimenti boss, bloccati e selezionato
  const everyone = view.scale / dpr >= ALL_LABELS_ZOOM;
  for (const e of s.entries.values()) {
    if (!isVisible(e.motion)) continue;
    const pose = poseOf(e.actor, e.motion);
    if (pose === 'type' && e.motion.at) use.screens.set(cellKey(inFront(e.motion.at)), e.actor.agent.area);
    if (pose === 'play') use.players++;
    const selected = e.actor.id === selectedId;
    ops.push(...actorOps({
      id: e.actor.id, pos: e.motion.pos, look: lookOf(e.actor, model), pose, facing: e.motion.facing,
      frame: frameAt(pose, now, seedOf(e.actor.id)), selected,
    }));
    rects.push(actorRect(e.actor.id, e.motion.pos));
    if (everyone || selected || e.actor.boss || e.actor.waiting) labels.push({ entry: e, ...feetOf(e.motion.pos) });
  }
  for (const f of solid) {
    const { frame, variant } = furnitureLook(f, use, now);
    ops.push(furnitureOp(f, frame, variant));
  }
  s.rects = rects;

  // disegno a scala intera: tutto allineato alla griglia dei pixel fisici
  const k = view.scale;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = PALETTE.void;
  ctx.fillRect(0, 0, bw, bh);
  const floor = floorLayer();
  ctx.drawImage(floor, view.ox, view.oy, floor.width * k, floor.height * k);
  const blit = (sp: Sprite, x: number, y: number) =>
    ctx.drawImage(sp.canvas, view.ox + (x - sp.ax) * k, view.oy + (y - sp.ay) * k, sp.w * k, sp.h * k);
  for (const op of sortByDepth(ops)) blit(spriteOf(op.sprite), op.x, op.y);

  // sopra a tutto: fumetti di chi è bloccato ed etichette; quelle in evidenza per ultime, sopra alle altre
  const bubble = cachedImage('x:bubble', bubbleImage);
  const rank = ({ entry }: { entry: Entry }) => (entry.actor.id === selectedId ? 3 : entry.actor.waiting ? 2 : entry.actor.boss ? 1 : 0);
  for (const { entry, x, y } of [...labels].sort((a, b) => rank(a) - rank(b))) {
    const { actor } = entry;
    let top = y - 21;
    if (actor.waiting) {
      blit(bubble, x, top - 2);
      top -= bubble.h + 1;
    }
    const selected = actor.id === selectedId;
    drawLabel(ctx, {
      text: labelText(agentName(actor.agent)),
      // il ruolo per i subagenti in evidenza; Claudio Code è il capo, il suo nome basta
      area: actor.boss || (everyone && !selected && !actor.waiting) ? null : actor.agent.area,
      selected,
      waiting: actor.waiting,
    }, view.ox + x * view.scale, view.oy + top * view.scale, dpr);
  }
}
