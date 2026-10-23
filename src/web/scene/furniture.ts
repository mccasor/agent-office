import * as THREE from 'three';
import { SEAT_HEIGHT } from '../characters/dimensions';
import { bake, capsule, clay, move, part, rbox, rcyl, UNIT, type Part, type V3 } from './clay';

/*
 * Arredi dell'ufficio: palette, materiali, texture procedurali e mobili cotti condivisi (vedi ./clay).
 * Le stanze (./rooms) li dispongono sul layout.
 */

/** Pareti di fondo (nord, ovest) alte; quelle verso la camera (sud, est) basse, come in uno spaccato. */
export const WALL_H = 2.2;
export const FRONT_WALL_H = 0.35;
export const WALL_T = 0.3;
export const GLASS_H = 1.5;
/** quota del piano delle scrivanie (condivisa con la tazza appoggiata, vedi DESK_CUP) */
export const DESK_TOP_Y = 0.745;
/** tazza appoggiata sulla scrivania, nel sistema del posto (+z verso la scrivania) */
export const DESK_CUP: [number, number, number] = [0.32, DESK_TOP_Y, 0.72];

export const HALF_PI = Math.PI / 2;

/** Palette dell'immagine di riferimento (rovere, nero, verde, moquette), scaldata e ammorbidita per lo stile clay. */
export const C = {
  base: '#f5f1ea',
  carpet: '#d2cdc5',
  parquet: '#c39467',
  rug: '#e8dccb',
  bossRug: '#959a83',
  oak: '#d8b285',
  walnut: '#7b5740',
  black: '#353339',
  chrome: '#cfcbc6',
  leather: '#7a4a36',
  fabric: '#d6c0a5',
  cushion: '#c8ae90',
  sofa: '#47774c',
  gold: '#d8ad48',
  orange: '#f2a541',
  paper: '#f7f1e6',
  sage: '#a3b994',
  terracotta: '#dc9070',
  butter: '#ecd07e',
  soil: '#4a3628',
  leaf: '#5c9757',
  leafDark: '#3f7845',
  leafLight: '#80b267',
};

/** Materiali condivisi dei pezzi non cotti (pavimenti, pareti, parti luminose, vetro). */
export const M = {
  base: clay(C.base),
  carpet: clay(C.carpet, { roughness: 1 }),
  parquet: clay(C.parquet),
  rug: clay(C.rug, { roughness: 1 }),
  bossRug: clay(C.bossRug, { roughness: 1 }),
  black: clay(C.black),
  oak: clay(C.oak),
  door: clay(C.orange, { emissive: C.orange, emissiveIntensity: 0.3 }),
  screen: clay('#22344a', { emissive: '#4a7fae', emissiveIntensity: 0.45, roughness: 0.5 }),
  lampLight: clay('#fff4d6', { emissive: '#ffe2a0', emissiveIntensity: 0.9 }),
  glass: new THREE.MeshStandardMaterial({ color: '#dcecf2', transparent: true, opacity: 0.25, roughness: 0.2, depthWrite: false }),
  leafDark: clay(C.leafDark),
};

/** Geometrie e mobili cotti condivisi (vedi ./clay): un draw call per mobile, smooth shading, spigoli smussati. */
export const G = {
  bulb: new THREE.SphereGeometry(0.025, 14, 10),
  screen: rbox(0.5, 0.29, 0.012, 0.006),
  indicator: rbox(0.06, 0.03, 0.008, 0.004),
  floorShade: rcyl(0.15, 0.24, 0.05, 28, 0.12),
};

/** Doghe verticali in rovere (texture procedurale) con sfumatura per doga, così sembrano bombate. */
export function slatTexture(length: number): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 8;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  for (let i = 0; i < 8; i++) {
    const g = ctx.createLinearGradient(i * 16, 0, i * 16 + 16, 0);
    g.addColorStop(0, '#a98058');
    g.addColorStop(0.25, '#d4ae80');
    g.addColorStop(0.55, '#e2c196');
    g.addColorStop(1, '#ad845b');
    ctx.fillStyle = g;
    ctx.fillRect(i * 16, 0, 16, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(length, 1);
  return t;
}

/** Muschio stabilizzato: bolle sfumate di verdi diversi su fondo scuro (texture procedurale, deterministica). */
export function mossTexture(length: number): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#2f4a25';
  ctx.fillRect(0, 0, 128, 128);
  const greens = ['#4a7a35', '#5f8f42', '#78a64e', '#558a45', '#8fb663', '#41682f'];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 200; i++) {
    const x = rnd() * 128;
    const y = rnd() * 128;
    const r = 5 + rnd() * 7;
    // bolla con luce in alto a sinistra e bordo scuro: dà volume senza geometria
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, '#b4d184');
    g.addColorStop(0.35, greens[i % greens.length]!);
    g.addColorStop(1, '#2c4522');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(length / 1.4, WALL_H / 1.4);
  return t;
}

/* ---------- pezzi riusabili (sistemi locali come nei vecchi modelli) ---------- */

/** Lampada da tavolo a braccio snodato, origine sul piano; il bulbo luminoso è a parte (LAMP_BULB). */
function lampParts(): Part[] {
  return [
    part(rcyl(0.06, 0.022, 0.009, 14), C.black, [0, 0.011, 0]),
    part(capsule(0.013, 0.42, 8), C.black, [0, 0.2, -0.04], [-0.25, 0, 0]),
    part(UNIT.small, C.black, [0, 0.4, -0.09], undefined, 0.036),
    part(capsule(0.013, 0.32, 8), C.black, [0, 0.4, 0.08], [1.1, 0, 0]),
    part(UNIT.bubble, C.black, [0, 0.42, 0.22], [-0.5, 0, 0], [0.13, 0.09, 0.13]),
  ];
}
export const LAMP_BULB: V3 = [0, 0.375, 0.245];

/** Monitor tutto-in-uno, origine sul piano; lo schermo luminoso è a parte (SCREEN_AT). */
function monitorParts(): Part[] {
  return [
    part(rcyl(0.1, 0.02, 0.009, 16), C.black, [0, 0.01, 0]),
    part(capsule(0.024, 0.24, 8), C.black, [0, 0.13, -0.025]),
    part(rbox(0.56, 0.36, 0.04, 0.026, 2), C.black, [0, 0.34, -0.005]),
  ];
}
export const SCREEN_AT: V3 = [0, 0.35, 0.016];

const keyboard = (p: V3): Part => part(rbox(0.38, 0.022, 0.12, 0.01), C.black, p);

/** Mensole con libri tondeggianti di colori pastello, origine al piede, fronte verso +z. */
function bookshelfParts(w: number, h: number, d: number, shelves: number[]): Part[] {
  const books = [C.paper, C.oak, C.sage, C.terracotta, C.butter, C.fabric];
  const parts: Part[] = [
    part(rbox(w - 0.04, h - 0.04, 0.04, 0.015), C.walnut, [0, h / 2, -d / 2 + 0.03]),
    part(rbox(0.06, h, d, 0.028), C.walnut, [-w / 2 + 0.03, h / 2, 0]),
    part(rbox(0.06, h, d, 0.028), C.walnut, [w / 2 - 0.03, h / 2, 0]),
    part(rbox(w, 0.06, d, 0.028), C.walnut, [0, h - 0.03, 0]),
    part(rbox(w, 0.08, d, 0.03), C.walnut, [0, 0.04, 0]),
  ];
  shelves.forEach((y, i) => {
    parts.push(part(rbox(w - 0.1, 0.035, d - 0.05, 0.015), C.walnut, [0, y, 0]));
    // libri in piedi e uno sdraiato, disposizione diversa per ripiano
    let x = -w / 2 + 0.1 + (i % 2) * 0.08;
    for (let k = 0; k < 4; k++) {
      const bh = 0.2 + ((i + k) % 3) * 0.035;
      parts.push(part(rbox(0.07, bh, d * 0.62, 0.025), books[(i * 2 + k) % books.length]!, [x, y + 0.018 + bh / 2, 0.01], [0, 0, k === 3 ? -0.18 : 0]));
      x += 0.085;
    }
    parts.push(part(rbox(0.24, 0.06, d * 0.6, 0.025), books[(i + 3) % books.length]!, [w / 2 - 0.2, y + 0.048, 0.01]));
    if (i !== 1) parts.push(part(UNIT.sphere, C.sage, [w / 2 - 0.2, y + 0.13, 0.01], undefined, 0.1));
  });
  return parts;
}

/** Bolle di fogliame lungo l'asse x (fioriere), centrate in `y`. */
export function hedgeParts(length: number, y: number, depth: number): Part[] {
  const bushes = Math.round(length * 3);
  const greens = [C.leafLight, C.leafDark, C.leaf];
  const parts: Part[] = [];
  for (let i = 0; i < bushes; i++) {
    const x = -length / 2 + (i + 0.5) * (length / bushes);
    parts.push(part(UNIT.bubble, greens[i % 3]!, [x, y, 0], undefined, [0.44, 0.34, depth]));
    parts.push(part(UNIT.bubble, greens[(i + 1) % 3]!, [x + 0.07, y + 0.12, i % 2 ? 0.05 : -0.05], undefined, 0.26));
  }
  return parts;
}

/* ---------- mobili cotti a livello di modulo ---------- */

const SEAT_T = 0.08;

/** Scrivania in rovere con telaio nero: local +z verso il posto, monitor e lampada verso la fioriera. */
export const DESK = bake([
  part(rbox(1, 0.05, 0.8, 0.022), C.oak, [0, DESK_TOP_Y - 0.025, 0.1]),
  ...[-0.46, 0.46].flatMap((x) => [
    part(capsule(0.03, 0.72, 8), C.black, [x, 0.36, 0.4]),
    part(capsule(0.03, 0.72, 8), C.black, [x, 0.36, -0.2]),
    part(capsule(0.03, 0.68, 8), C.black, [x, 0.03, 0.1], [HALF_PI, 0, 0]),
  ]),
  ...move(monitorParts(), [0.05, DESK_TOP_Y, -0.12]),
  keyboard([0.05, DESK_TOP_Y + 0.011, 0.2]),
  ...move(lampParts(), [-0.38, DESK_TOP_Y, -0.15]),
]);
export const DESK_SCREEN: V3 = [0.05 + SCREEN_AT[0], DESK_TOP_Y + SCREEN_AT[1], -0.12 + SCREEN_AT[2]];
export const DESK_BULB: V3 = [-0.38 + LAMP_BULB[0], DESK_TOP_Y + LAMP_BULB[1], -0.15 + LAMP_BULB[2]];

/** Sedia con base a stella: local +z verso la scrivania, schienale dietro; piano della seduta a SEAT_HEIGHT. */
function chairGeometry(seat: string, tall: boolean): THREE.BufferGeometry {
  const backH = tall ? 0.75 : 0.5;
  const parts: Part[] = [];
  for (let i = 0; i < 5; i++) {
    parts.push(...move([
      part(capsule(0.022, 0.3, 8), C.chrome, [0, 0.04, 0.14], [HALF_PI, 0, 0]),
      part(UNIT.small, C.black, [0, 0.026, 0.27], undefined, 0.052),
    ], [0, 0, 0], [0, i * 1.2566, 0]));
  }
  const poleY0 = 0.04;
  const poleY1 = SEAT_HEIGHT - SEAT_T + 0.01;
  parts.push(
    part(rcyl(0.055, 0.04, 0.016, 14), C.chrome, [0, 0.045, 0]),
    part(UNIT.cyl, C.chrome, [0, (poleY0 + poleY1) / 2, 0], undefined, [0.05, poleY1 - poleY0, 0.05]),
    part(rbox(0.48, SEAT_T, 0.46, 0.036), seat, [0, SEAT_HEIGHT - SEAT_T / 2, 0]),
    part(rbox(0.46, backH, 0.08, 0.038), seat, [0, SEAT_HEIGHT + backH / 2 - 0.01, -0.21]),
  );
  for (const x of [-0.25, 0.25]) {
    parts.push(
      part(capsule(0.016, 0.14, 8), C.chrome, [x, SEAT_HEIGHT + 0.06, -0.08]),
      part(rbox(0.055, 0.035, 0.3, 0.017), seat, [x, SEAT_HEIGHT + 0.13, -0.03]),
    );
  }
  return bake(move(parts, [0, 0, -0.08]));
}
export const CHAIR = chairGeometry(C.black, false);
export const BOSS_CHAIR = chairGeometry(C.leather, true);

/** Fioriera nera lunga 2 celle con siepe a bolle, sul giunto tra due file di scrivanie (divisorio delle isole). */
const PLANTER_LEN = 2;
export const PLANTER = bake([
  part(rbox(PLANTER_LEN, 1, 0.4, 0.08), C.black, [0, 0.5, 0]),
  part(rbox(PLANTER_LEN - 0.08, 0.04, 0.32, 0.015), C.soil, [0, 0.995, 0]),
  ...hedgeParts(PLANTER_LEN, 1.04, 0.38),
]);

/** Pianta in vaso con chioma a bolle morbide. */
export const PLANT = bake([
  part(rcyl(0.16, 0.4, 0.05, 22, 0.2), C.black, [0, 0.2, 0]),
  part(rcyl(0.17, 0.03, 0.012, 18), C.soil, [0, 0.39, 0]),
  part(UNIT.bubble, C.leaf, [0, 0.66, 0], undefined, [0.62, 0.7, 0.62]),
  part(UNIT.bubble, C.leafDark, [0.15, 0.9, 0.05], undefined, 0.42),
  part(UNIT.bubble, C.leafLight, [-0.13, 0.85, -0.09], undefined, 0.38),
  part(UNIT.bubble, C.leafLight, [0.04, 1.04, -0.04], undefined, 0.3),
  part(UNIT.bubble, C.leafDark, [-0.1, 0.68, 0.17], undefined, 0.34),
]);

/** Poltroncina imbottita: local +z verso il tavolino, piano della seduta a SEAT_HEIGHT. */
export const ARMCHAIR = bake(move([
  ...[-0.24, 0.24].flatMap((x) => [-0.2, 0.2].map((z) => part(rcyl(0.028, 0.05, 0.01, 12), C.black, [x, 0.025, z]))),
  part(rbox(0.62, 0.16, 0.54, 0.05, 3), C.fabric, [0, 0.12, 0]),
  part(rbox(0.56, 0.12, 0.52, 0.05, 3), C.cushion, [0, SEAT_HEIGHT - 0.06, 0.01]),
  part(rbox(0.66, 0.5, 0.14, 0.06, 3), C.fabric, [0, 0.48, -0.27]),
  ...[-1, 1].map((sx) => part(rbox(0.12, 0.36, 0.56, 0.055, 3), C.fabric, [sx * 0.33, 0.29, -0.02])),
], [0, 0, -0.08]));

/** Divanetto a due posti (uno per cella): local +z verso il tavolino, lungo l'asse x locale. */
export const LOVESEAT = bake(move([
  part(rbox(1.9, 0.1, 0.62, 0.04, 3), C.oak, [0, 0.05, 0]),
  part(rbox(1.84, 0.1, 0.58, 0.04, 3), C.sofa, [0, 0.14, 0]),
  ...[-0.47, 0.47].map((x) => part(rbox(0.92, 0.15, 0.56, 0.06, 3), C.sofa, [x, SEAT_HEIGHT - 0.075, 0.02])),
  part(rbox(1.9, 0.5, 0.16, 0.07, 3), C.sofa, [0, 0.5, -0.28]),
  ...[-1, 1].map((sx) => part(rbox(0.16, 0.4, 0.62, 0.07, 3), C.sofa, [sx * 0.98, 0.31, -0.02])),
], [0, 0, -0.08]));

/** Tavolino ovale su colonna, con un foglio appoggiato. */
export const LOUNGE_TABLE = bake([
  part(rcyl(0.5, 0.045, 0.02, 32), C.oak, [0, 0.36, 0], undefined, [0.8, 1, 1.4]),
  part(UNIT.cyl, C.black, [0, 0.18, 0], undefined, [0.08, 0.34, 0.08]),
  part(rcyl(0.2, 0.026, 0.011, 24), C.black, [0, 0.013, 0]),
  part(rbox(0.2, 0.008, 0.28, 0.0035), C.paper, [0.05, 0.386, -0.3], [0, 0.4, 0]),
]);

export const BOSS_SHELF = bake(bookshelfParts(1.1, 1.8, 0.3, [0.45, 0.9, 1.35]));
export const LOUNGE_SHELF = bake(bookshelfParts(0.9, 1.7, 0.36, [0.3, 0.75, 1.2]));

/** Bancone nero con piano in rovere, macchina del caffè e tazze. */
export const BAR = bake([
  part(rbox(1.9, 0.9, 0.6, 0.06, 3), C.black, [0, 0.45, 0]),
  part(rbox(1.96, 0.05, 0.64, 0.022, 3), C.oak, [0, 0.92, 0]),
  ...move([
    part(rbox(0.36, 0.4, 0.34, 0.06, 3), C.chrome, [0, 0.2, 0]),
    part(rbox(0.22, 0.08, 0.1, 0.03), C.black, [0, 0.12, 0.13]),
    part(rbox(0.24, 0.02, 0.16, 0.008), C.black, [0, 0.01, 0.1]),
  ], [-0.4, 0.945, -0.05]),
  ...[0.15, 0.32, 0.5].map((x) => part(rcyl(0.036, 0.1, 0.014, 16, 0.042), C.paper, [x, 0.995, 0.05])),
]);
export const BAR_INDICATOR: V3 = [-0.3, 0.945 + 0.32, -0.05 + 0.172];

/** Lampada da terra: base e stelo cotti, paralume luminoso a parte. */
export const FLOOR_LAMP = bake([
  part(rcyl(0.14, 0.03, 0.013, 24), C.black, [0, 0.015, 0]),
  part(capsule(0.018, 1.48, 8), C.black, [0, 0.76, 0]),
]);

/** Lesena scura sulla parete di fondo, quadro e libreria nella stanza del boss, parete di muschio dell'area relax. */
export const PILASTER = rbox(0.6, WALL_H, 0.06, 0.028, 3);
export const PAINTING = bake([
  part(rbox(0.06, 0.8, 1.1, 0.028, 3), C.black, [0, 0, 0]),
  part(rbox(0.02, 0.66, 0.96, 0.009), C.orange, [0.03, 0, 0]),
  // composizione astratta in rilievo morbido
  part(UNIT.sphere, C.terracotta, [0.045, 0.08, -0.2], undefined, [0.03, 0.3, 0.3]),
  part(UNIT.sphere, C.butter, [0.045, -0.12, 0.18], undefined, [0.03, 0.22, 0.34]),
]);

/** Zerbino arancione e stipiti della porta. */
export const DOOR_MAT = rbox(0.9, 0.024, 1.9, 0.011, 3);
export const DOOR_POST = rbox(0.12, FRONT_WALL_H + 0.45, WALL_T + 0.1, 0.05, 3);

/** Scrivania del boss in noce con due monitor e targhetta dorata; schermi e bulbo luminosi a parte. */
export const BOSS_MONITORS: { p: V3; ry: number }[] = [-0.32, 0.32].map((x) => ({ p: [x, DESK_TOP_Y, -0.1], ry: -x * 0.6 }));
export const BOSS_LAMP_X = -0.58;
export const BOSS_DESK = bake([
  part(rbox(1.4, 0.06, 0.85, 0.026, 3), C.walnut, [0, DESK_TOP_Y - 0.03, 0.1]),
  part(rbox(1.36, 0.7, 0.05, 0.022, 3), C.walnut, [0, 0.36, -0.28]),
  ...[-0.66, 0.66].map((x) => part(rbox(0.07, 0.72, 0.8, 0.03, 3), C.black, [x, 0.36, 0.1])),
  ...BOSS_MONITORS.flatMap(({ p, ry }) => move(monitorParts(), p, [0, ry, 0])),
  keyboard([0, DESK_TOP_Y + 0.011, 0.22]),
  ...move(lampParts(), [BOSS_LAMP_X, DESK_TOP_Y, -0.1]),
  // targhetta "Claudio Code" sul fronte verso la stanza
  part(rbox(0.4, 0.06, 0.016, 0.007), C.gold, [0, DESK_TOP_Y - 0.03, -0.31]),
]);
/** Statuetta dorata sulla prima scrivania del boss. */
export const BOSS_STATUE = bake(move([
  part(rbox(0.1, 0.06, 0.1, 0.022), C.black, [0, 0.03, 0]),
  part(capsule(0.028, 0.17, 10), C.gold, [0, 0.14, 0], [0, 0, 0.2]),
  part(UNIT.sphere, C.gold, [0.02, 0.25, 0], undefined, 0.065),
], [0.58, DESK_TOP_Y, -0.1]));

