/**
 * Anteprima degli sprite della vista 2D (#73) in un PNG, senza browser né dipendenze:
 *   npx tsx scripts/pixel-preview.ts [uscita.png] [scala] [x,y,w,h | pianta] [x,y,w,h]
 * Personaggi (tutte le pose, direzioni e fotogrammi), arredi, schermi a tema, tile e una stanza di prova; con
 * `pianta` l'ufficio intero con tutti gli arredi, agenti al lavoro e giocatori al biliardino.
 */
import { writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { actorOps, cellKey, FLAT, furnitureOp, inFront, sceneFurniture, sortByDepth, wallFaceVisible, type DrawOp } from '../src/web/pixel/draw';
import { createPlan } from '../src/web/pixel/plan';
import { furnitureLook, type FurnitureUse } from '../src/web/pixel/screens';
import {
  bossLook, bubbleImage, characterImage, FOOSBALL_FRAMES, furnitureImage, pickLook, POSE_FRAMES, rgba, SCREEN_FRAMES, SCREEN_THEMES,
  selectionImage, shadowImage, tileImage, type PixelImage,
} from '../src/web/pixel/sprites';
import { TILE, type Facing, type FurnitureKind, type Pose, type TileKind } from '../src/web/pixel/types';

const out = process.argv[2] ?? 'pixel-preview.png';
const SCALE = Number(process.argv[3] ?? 2);
const PLAN_MODE = process.argv[4] === 'pianta';
/** ritaglio facoltativo "x,y,w,h" (in pixel a scala 1) per guardare i dettagli */
const crop = process.argv[PLAN_MODE ? 5 : 4]?.split(',').map(Number);

const officePlan = createPlan();
const W = PLAN_MODE ? officePlan.width * TILE : 470;
const H = PLAN_MODE ? officePlan.depth * TILE : 1110;
const sheet = new Uint8ClampedArray(W * H * 4);
const bg = rgba('#3a3040');
for (let i = 0; i < W * H; i++) sheet.set(bg, i * 4);

/** disegna con alpha blending; (x, y) è dove va l'ancora */
function blit(img: PixelImage, x: number, y: number): void {
  const ox = x - img.ax;
  const oy = y - img.ay;
  for (let j = 0; j < img.h; j++) {
    for (let i = 0; i < img.w; i++) {
      const sx = ox + i;
      const sy = oy + j;
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
      const s = (j * img.w + i) * 4;
      const a = img.data[s + 3]! / 255;
      if (a === 0) continue;
      const d = (sy * W + sx) * 4;
      for (let k = 0; k < 3; k++) sheet[d + k] = img.data[s + k]! * a + sheet[d + k]! * (1 - a);
    }
  }
}

const FACINGS: Facing[] = ['down', 'right', 'up', 'left'];
const POSES: Pose[] = ['stand', 'walk', 'sit', 'type', 'play'];
// boss e un agente per ogni stile di capelli e accessorio (id scelti per coprire i preset)
const looks = [bossLook(0), bossLook(1), ...['agent-2', 'agent-1', 'agent-8', 'agent-19', 'agent-4', 'agent-14', 'agent-15'].map(pickLook)];

// personaggi: una riga per look, posa dopo posa
let y = 28;
for (const look of looks) {
  let x = 12;
  for (const pose of POSES) {
    for (const facing of FACINGS) {
      for (let f = 0; f < POSE_FRAMES[pose]; f++) {
        blit(characterImage(look, pose, facing, f), x, y);
        x += 17;
        if (x > W - 10) break;
      }
    }
    if (pose === 'walk' || pose === 'type') {
      x = 12;
      y += 28;
    }
  }
  y += 28;
}

// arredi
const FURN: [FurnitureKind, Facing, number, number][] = [
  ['desk', 'down', 2, 1], ['boss-desk', 'down', 3, 1], ['chair', 'down', 1, 1], ['chair', 'up', 1, 1], ['chair', 'right', 1, 1],
  ['monitor', 'down', 1, 1], ['monitor', 'up', 1, 1], ['monitor', 'left', 1, 1], ['plant', 'down', 1, 1],
  ['sofa', 'down', 2, 1], ['sofa', 'up', 2, 1], ['sofa', 'right', 1, 2], ['armchair', 'down', 1, 1], ['armchair', 'left', 1, 1],
  ['coffee-table', 'down', 2, 1], ['coffee-machine', 'down', 1, 1], ['water-cooler', 'down', 1, 1], ['bookshelf', 'down', 2, 1],
  ['rug', 'down', 3, 2], ['whiteboard', 'down', 2, 1], ['window', 'down', 2, 1],
  ['floor-lamp', 'down', 1, 1], ['cabinet', 'down', 1, 1], ['cabinet', 'up', 1, 1], ['locker', 'down', 2, 1], ['printer', 'down', 1, 1],
  ['printer', 'up', 1, 1], ['bin', 'down', 1, 1], ['coat-rack', 'down', 1, 1], ['plant-tall', 'down', 1, 1], ['cactus', 'down', 1, 1],
  ['vending', 'down', 1, 1], ['fridge', 'down', 1, 1], ['foosball', 'down', 2, 1], ['clock', 'down', 1, 1], ['corkboard', 'down', 2, 1],
];
let fx = 8;
let fy = y + 26;
for (const [kind, facing, w, h] of FURN) {
  const img = furnitureImage(kind, facing, w, h);
  if (fx + img.w > W - 8) {
    fx = 8;
    fy += 52;
  }
  blit(img, fx, fy);
  fx += img.w + 6;
}
blit(furnitureImage('monitor', 'down', 1, 1, 1), fx, fy);
blit(furnitureImage('monitor', 'down', 1, 1, -1), fx + 20, fy);
blit(bubbleImage(), fx + 48, fy + 12);
blit(shadowImage(), fx + 66, fy + 12);
blit(selectionImage(), fx + 90, fy + 12);

// varianti: tappeti, quadri, poster, cabinati
fy += 52;
for (let v = 0; v < 4; v++) blit(furnitureImage('rug', 'down', 2, 1, 0, v), 8 + v * 36, fy);
for (let v = 0; v < 6; v++) blit(furnitureImage('painting', 'down', 1, 1, 0, v), 156 + v * 18, fy - 2);
for (let v = 0; v < 2; v++) blit(furnitureImage('poster', 'down', 1, 1, 0, v), 266 + v * 18, fy - 2);
for (let v = 0; v < 2; v++) blit(furnitureImage('arcade', 'down', 1, 1, 0, v), 310 + v * 18, fy);

// schermi a tema (#90): una riga per tema, tutti i fotogrammi; poi la partita al biliardino
fy += 30;
for (const [t] of SCREEN_THEMES.entries()) {
  const row = Math.floor(t / 2);
  const col = t % 2;
  for (let f = 0; f < SCREEN_FRAMES; f++) blit(furnitureImage('monitor', 'down', 1, 1, f, t), 8 + col * 230 + f * 18, fy + row * 22);
}
fy += Math.ceil(SCREEN_THEMES.length / 2) * 22 + 6;
for (let f = 0; f < FOOSBALL_FRAMES; f++) blit(furnitureImage('foosball', 'down', 2, 1, f), 8 + f * 36, fy);
fy += 10;

// tile
const TILES: [TileKind, boolean][] = [['floor', false], ['lounge', false], ['corridor', false], ['wall', true], ['wall', false], ['door', false], ['void', false]];
let tx = 8;
const ty = fy + 40;
for (const [kind, face] of TILES) {
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) blit(tileImage(kind, i, j, face && j === 0), tx + i * 16, ty + j * 16);
  tx += 38;
}

// stanza di prova: pareti, parquet, scrivanie con persone sedute e un divano
const RX = 8;
const RY = ty + 44;
const RW = 18;
const RH = 7;
for (let j = 0; j < RH; j++) {
  for (let i = 0; i < RW; i++) {
    const wall = j === 0 || i === 0 || i === RW - 1;
    const kind: TileKind = wall ? 'wall' : i > 11 ? 'lounge' : 'floor';
    blit(tileImage(kind, i, j, wall && j === 0 && i > 0 && i < RW - 1), RX + i * 16, RY + j * 16);
  }
}
const at = (cx: number, cz: number): [number, number] => [RX + cx * 16, RY + cz * 16];
const place = (kind: FurnitureKind, facing: Facing, cx: number, cz: number, w = 1, h = 1, f = 0) => blit(furnitureImage(kind, facing, w, h, f), ...at(cx, cz));
const actor = (look: number, pose: Pose, facing: Facing, cx: number, cz: number, f = 0) => {
  const [px, py] = at(cx, cz);
  blit(shadowImage(), px + 8, py + 13);
  blit(characterImage(looks[look]!, pose, facing, f), px + 8, py + 14);
};
place('window', 'down', 2, 0, 2, 1);
place('whiteboard', 'down', 6, 1, 2, 1);
place('bookshelf', 'down', 14, 1, 2, 1);
place('rug', 'down', 12, 3, 4, 3);
place('plant', 'down', 1, 1);
place('plant', 'down', 16, 5);
place('desk', 'down', 2, 2, 2, 1);
place('monitor', 'down', 2, 2, 1, 1, 0);
place('monitor', 'down', 3, 2, 1, 1, -1);
place('boss-desk', 'down', 7, 3, 3, 1);
place('monitor', 'down', 8, 3, 1, 1, 1);
place('chair', 'up', 3, 3);
actor(2, 'type', 'up', 2, 3, 1);
place('chair', 'up', 8, 4);
actor(0, 'type', 'up', 8, 4, 0);
place('sofa', 'down', 12, 2, 2, 1);
actor(3, 'sit', 'down', 13, 2);
place('armchair', 'right', 12, 4);
actor(4, 'sit', 'right', 12, 4);
place('coffee-table', 'down', 13, 4, 2, 1);
actor(5, 'walk', 'right', 5, 5, 0);
actor(6, 'walk', 'down', 10, 5, 1);
actor(7, 'stand', 'left', 16, 3);
const [bx, by] = at(8, 4);
blit(bubbleImage(), bx + 8, by - 10);
place('coffee-machine', 'down', 15, 1);

// pianta intera: pavimenti, arredi, agenti al lavoro con gli schermi a tema, biliardino in partita
if (PLAN_MODE) {

  for (let i = 0; i < W * H; i++) sheet.set(rgba('#2a2030'), i * 4);
  const plan = officePlan;
  for (let z = 0; z < plan.depth; z++) {
    for (let x = 0; x < plan.width; x++) {
      const kind = plan.tiles[z]![x]!;
      blit(tileImage(kind, x, z, kind === 'wall' && wallFaceVisible(plan, x, z), plan.styles[z]![x]!), x * TILE, z * TILE);
    }
  }
  const furniture = sceneFurniture(plan);
  for (const f of furniture.filter((f) => FLAT.has(f.kind))) blit(furnitureImage(f.kind, f.facing, f.w, f.h, 0, f.variant), f.cell.x * TILE, f.cell.z * TILE);
  const areas = ['backend', 'frontend', 'devops', 'test', 'design', 'docs', 'research', 'architecture', 'other'];
  const use: FurnitureUse = { screens: new Map(), players: 0 };
  const ops: DrawOp[] = [];
  let n = 0;
  for (const room of plan.rooms) {
    // in ogni stanza istanza 6 agenti al lavoro con ruoli diversi e il boss
    const spots = room.kind === 'lounge' ? room.seats.slice(0, 7) : [room.boss!, ...room.desks.slice(0, 6)];
    for (const spot of spots) {
      const working = room.kind !== 'lounge';
      const pose: Pose = !working ? (spot.id.startsWith('foos-') ? 'play' : spot.seated ? 'sit' : 'stand') : 'type';
      const area = spot.id.endsWith('-boss') ? 'architecture' : areas[n % areas.length]!;
      if (pose === 'type') use.screens.set(cellKey(inFront(spot)), area);
      if (pose === 'play') use.players++;
      const look = spot.id.endsWith('-boss') ? bossLook(plan.rooms.indexOf(room)) : pickLook(`agent-${n}`);
      ops.push(...actorOps({ id: spot.id, pos: spot.cell, look, pose, facing: spot.facing, frame: n, selected: false }));
      n++;
    }
  }
  const now = Number(process.env.T ?? 1.25);
  for (const f of furniture.filter((f) => !FLAT.has(f.kind))) {
    const { frame, variant } = furnitureLook(f, use, now);
    ops.push(furnitureOp(f, frame, variant));
  }
  for (const op of sortByDepth(ops)) {
    const s = op.sprite;
    const img =
      s.type === 'furniture' ? furnitureImage(s.kind, s.facing, s.w, s.h, s.frame, s.variant)
      : s.type === 'character' ? characterImage(s.look, s.pose, s.facing, s.frame)
      : s.type === 'shadow' ? shadowImage()
      : selectionImage();
    blit(img, op.x, op.y);
  }
}

// PNG RGB scalato
const [CX, CY, CW, CH] = crop && crop.length === 4 ? crop as [number, number, number, number] : [0, 0, W, H];
const OW = CW * SCALE;
const OH = CH * SCALE;
const raw = Buffer.alloc((OW * 3 + 1) * OH);
for (let oy = 0; oy < OH; oy++) {
  raw[oy * (OW * 3 + 1)] = 0;
  for (let ox = 0; ox < OW; ox++) {
    const s = ((CY + Math.floor(oy / SCALE)) * W + CX + Math.floor(ox / SCALE)) * 4;
    const d = oy * (OW * 3 + 1) + 1 + ox * 3;
    raw[d] = sheet[s]!;
    raw[d + 1] = sheet[s + 1]!;
    raw[d + 2] = sheet[s + 2]!;
  }
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(OW, 0);
ihdr.writeUInt32BE(OH, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(out, png);
console.log(`${out}: ${OW}×${OH}`);
