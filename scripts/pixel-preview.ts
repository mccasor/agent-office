/**
 * Anteprima degli sprite della vista 2D (#73) in un PNG, senza browser né dipendenze:
 *   npx tsx scripts/pixel-preview.ts [uscita.png] [scala]
 * Personaggi (tutte le pose, direzioni e fotogrammi), arredi, tile e una stanza di prova.
 */
import { writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import {
  bossLook, bubbleImage, characterImage, furnitureImage, pickLook, POSE_FRAMES, rgba, selectionImage, shadowImage, tileImage,
  type PixelImage,
} from '../src/web/pixel/sprites';
import type { Facing, FurnitureKind, Pose, TileKind } from '../src/web/pixel/types';

const out = process.argv[2] ?? 'pixel-preview.png';
const SCALE = Number(process.argv[3] ?? 2);
/** ritaglio facoltativo "x,y,w,h" (in pixel a scala 1) per guardare i dettagli */
const crop = process.argv[4]?.split(',').map(Number);

const W = 470;
const H = 860;
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
const POSES: Pose[] = ['stand', 'walk', 'sit', 'type'];
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
    if (pose === 'walk') {
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
