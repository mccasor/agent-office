import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { Snapshot } from '../../shared/types';
import { StartQueue } from '../scene/motion';
import { arrivedAt, frameAt, isVisible, poseOf, stepMotion, type ActorMotion } from './actors';
import {
  actorOps, actorRect, cellKey, furnitureOp, FLAT, feetOf, hitTest, inFront, sceneFurniture, sortByDepth,
  viewportFor, wallFaceVisible, type DrawOp, type HitRect, type SpriteRef, type Viewport,
} from './draw';
import { EMPTY_PIXEL_SEATING, pixelModel } from './model';
import { createPlan } from './plan';
import {
  bossLook, bubbleImage, cachedImage, characterSprite, furnitureSprite, PALETTE, pickLook, selectionImage, shadowImage,
  tileSprite, toCanvas, type PixelLook, type Sprite, type SpriteCanvas,
} from './sprites';
import { TILE, type PixelActor, type PixelModel } from './types';

/** animazioni semplici: 30 fotogrammi al secondo bastano, come nella vista 3D */
const MAX_FPS = 30;
/** fotogrammi al secondo dei monitor accesi */
const SCREEN_FPS = 2;

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
        const s = tileSprite(kind, x, z, kind === 'wall' && wallFaceVisible(plan, x, z));
        ctx.drawImage(s.canvas, x * TILE - s.ax, z * TILE - s.ay);
      }
    }
    for (const f of flat) {
      const s = furnitureSprite(f.kind, f.facing, f.w, f.h);
      ctx.drawImage(s.canvas, f.cell.x * TILE - s.ax, f.cell.z * TILE - s.ay);
    }
  }
  floorCanvas = canvas;
  return canvas;
}

const spriteOf = (ref: SpriteRef): Sprite => {
  switch (ref.type) {
    case 'furniture': return furnitureSprite(ref.kind, ref.facing, ref.w, ref.h, ref.frame);
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

/** nome breve per l'etichetta */
const shortName = (name: string): string => (name.length > 32 ? `${name.slice(0, 31)}…` : name);

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
  const live = useRef<Live>({ model, selectedId });
  useEffect(() => {
    live.current = { model, selectedId };
  }, [model, selectedId]);
  const sim = useRef<Sim>({ entries: new Map(), queue: new StartQueue(), fresh: true, rects: [], view: { scale: 1, ox: 0, oy: 0 } });

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
      render(el, ctx, sim.current, live.current, now, dt);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  const pick = (ev: MouseEvent<HTMLCanvasElement>): string | null => {
    const el = ev.currentTarget;
    const r = el.getBoundingClientRect();
    const { scale, ox, oy } = sim.current.view;
    const px = ((ev.clientX - r.left) * (el.width / r.width) - ox) / scale;
    const py = ((ev.clientY - r.top) * (el.height / r.height) - oy) / scale;
    return hitTest(sim.current.rects, px, py);
  };

  return (
    <canvas
      ref={canvas}
      className="pixel-office"
      onClick={(ev) => onSelect(pick(ev))}
      onPointerMove={(ev) => {
        ev.currentTarget.style.cursor = pick(ev) ? 'pointer' : '';
      }}
    />
  );
}

/** aggiorna i movimenti e disegna un fotogramma */
function render(el: HTMLCanvasElement, ctx: CanvasRenderingContext2D, s: Sim, live: Live, now: number, dt: number): void {
  const { model, selectedId } = live;

  // backing store in pixel fisici
  const dpr = window.devicePixelRatio || 1;
  const bw = Math.max(1, Math.round(el.clientWidth * dpr));
  const bh = Math.max(1, Math.round(el.clientHeight * dpr));
  if (el.width !== bw || el.height !== bh) {
    el.width = bw;
    el.height = bh;
  }
  const view = viewportFor(bw, bh, plan, Math.round(16 * dpr));
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

  // chi digita alla propria scrivania accende il monitor che ha davanti
  const ops: DrawOp[] = [];
  const rects: HitRect[] = [];
  const typing = new Set<string>();
  const labels: { entry: Entry; x: number; y: number }[] = [];
  for (const e of s.entries.values()) {
    if (!isVisible(e.motion)) continue;
    const pose = poseOf(e.actor, e.motion);
    if (pose === 'type' && e.motion.at) typing.add(cellKey(inFront(e.motion.at)));
    const selected = e.actor.id === selectedId;
    ops.push(...actorOps({
      id: e.actor.id, pos: e.motion.pos, look: lookOf(e.actor, model), pose, facing: e.motion.facing,
      frame: frameAt(pose, now, seedOf(e.actor.id)), selected,
    }));
    rects.push(actorRect(e.actor.id, e.motion.pos));
    if (selected || e.actor.boss) labels.push({ entry: e, ...feetOf(e.motion.pos) });
  }
  const screen = Math.floor(now * SCREEN_FPS);
  for (const f of solid) {
    ops.push(furnitureOp(f, f.kind === 'monitor' ? (typing.has(cellKey(f.cell)) ? screen : -1) : 0));
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

  // sopra a tutto: fumetti dei boss bloccati ed etichette (boss e selezionato)
  const bubble = cachedImage('x:bubble', bubbleImage);
  for (const { entry, x, y } of labels) {
    let top = y - 21;
    if (entry.actor.waiting && entry.actor.boss) {
      blit(bubble, x, top - 2);
      top -= bubble.h + 1;
    }
    drawLabel(ctx, view, dpr, x, top, shortName(entry.actor.agent.name), {
      selected: entry.actor.id === selectedId,
      waiting: entry.actor.waiting,
    });
  }
}

/** Etichetta col nome: testo piccolo su una targhetta scura, centrata in x e con il fondo in y (pixel a scala 1). */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  view: Viewport,
  dpr: number,
  x: number,
  bottom: number,
  text: string,
  { selected, waiting }: { selected: boolean; waiting: boolean },
): void {
  const font = Math.round(11 * dpr);
  ctx.font = `600 ${font}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  const padX = Math.round(4 * dpr);
  const h = Math.round(font + 4 * dpr);
  const w = Math.ceil(ctx.measureText(text).width) + 2 * padX;
  const cx = view.ox + x * view.scale;
  const left = Math.round(cx - w / 2);
  const top = Math.round(view.oy + bottom * view.scale - h);
  ctx.fillStyle = selected ? PALETTE.select[1] : waiting ? PALETTE.bubble[1] : PALETTE.outline;
  ctx.globalAlpha = selected || waiting ? 1 : 0.85;
  ctx.fillRect(left, top, w, h);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = PALETTE.outline;
  ctx.lineWidth = Math.max(1, Math.round(dpr));
  ctx.strokeRect(left + ctx.lineWidth / 2, top + ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
  ctx.fillStyle = selected ? PALETTE.outline : '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, left + w / 2, top + h / 2 + Math.round(dpr / 2));
}
