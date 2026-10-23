/**
 * Sprite in pixel art della vista 2D (#73), definiti in codice: funzioni pure che producono pixel RGBA (testabili
 * senza canvas) e un piccolo strato che li converte in canvas con cache. Vista dall'alto a 3/4: pavimenti visti
 * dall'alto, arredi con il piano e il fronte, personaggi chibi (circa 16×24) con contorno scuro di 1 px.
 * Una sola palette (PALETTE): rampe a 3-4 toni, dal chiaro allo scuro, luce da nord-ovest.
 */
import { bossPreset, pickPreset, type CharacterPreset } from './presets';
import { TILE, type Facing, type FurnitureKind, type Pose, type TileKind } from './types';

/** rampa di un colore: chiaro, base, ombra */
export type Ramp = readonly [string, string, string];
/** rampa a 4 toni per arredi e pavimenti: luce, chiaro, base, ombra */
export type Ramp4 = readonly [string, string, string, string];

export const PALETTE = {
  outline: '#2a1a26',
  shadow: '#2a1a2670',
  glass: '#cfe8f2',
  skin: {
    pale: ['#ffe2d2', '#fbc8b2', '#e19c88'],
    peach: ['#ffd0b2', '#f2b08c', '#cf8666'],
    rosy: ['#ffbcaa', '#f4938a', '#cc6466'],
    tan: ['#f2bb92', '#d99a72', '#b07052'],
    brown: ['#c98a66', '#a8694c', '#7f4a36'],
    deep: ['#9c654c', '#764634', '#55301f'],
  },
  hair: {
    black: ['#4a3d4f', '#241c26', '#140e14'],
    darkBrown: ['#634634', '#3d2b20', '#26170f'],
    brown: ['#937050', '#6b4f3a', '#4a3426'],
    auburn: ['#c4603f', '#963c2c', '#68261e'],
    ginger: ['#ec9256', '#c55c33', '#8e3b22'],
    blonde: ['#f7dc8c', '#e0ad4a', '#ae7c2a'],
    grey: ['#e2dee2', '#b4b0b4', '#857f8a'],
    navy: ['#5a5ca4', '#36366c', '#22224a'],
    plum: ['#9a4a6e', '#6a2a48', '#46182e'],
  },
  cloth: {
    blue: ['#8ab4e2', '#5b8bc4', '#3d6497'],
    coral: ['#f7a891', '#e8826a', '#bc5a48'],
    mint: ['#b2e2c6', '#86c2a3', '#5e9a7e'],
    sand: ['#fae2b4', '#f2cc8f', '#cca064'],
    violet: ['#a48cba', '#7d6493', '#5a466e'],
    teal: ['#62c8b8', '#2fa596', '#1f7a6f'],
    mustard: ['#f7da88', '#ecc45e', '#c49a3a'],
    steel: ['#8aa8c4', '#5f82a3', '#43607e'],
    rose: ['#de96a6', '#c06c80', '#94485c'],
    amber: ['#f9c48e', '#f4a261', '#cc7a3c'],
    lime: ['#c0de9a', '#97c46f', '#6f9a4c'],
    grey: ['#959cab', '#6a7182', '#4b5060'],
    jade: ['#7acbac', '#4bb08f', '#33876a'],
    salmon: ['#f9aaa8', '#f28482', '#c85e60'],
    claude: ['#ef9e7e', '#d97757', '#ad553a'],
    white: ['#ffffff', '#f2ece4', '#d2c8bc'],
  },
  pants: {
    charcoal: ['#4c5262', '#2f3542', '#1e222c'],
    indigo: ['#5c5f84', '#3d405b', '#292b3f'],
    slate: ['#666a86', '#4a4e69', '#33364a'],
    petrol: ['#3c6474', '#264653', '#18303a'],
    forest: ['#50705c', '#344e41', '#22352b'],
    navy: ['#33507c', '#1d3557', '#12233b'],
    dark: ['#4e4b4e', '#3a3a3a', '#262626'],
    denim: ['#4e6e94', '#355070', '#243a52'],
  },
  shoes: {
    brown: ['#7a5444', '#523a30', '#33231e'],
    black: ['#4a4450', '#2e2a32', '#1c1a20'],
    white: ['#ffffff', '#e2dcd6', '#b0a8a4'],
    red: ['#e2685e', '#b0434a', '#7c2a34'],
  },
  tie: ['#e05a62', '#b33a4a', '#7e2433'],
  headset: ['#6e6874', '#423e48', '#29262e'],
  // ambiente
  wood: ['#f0c690', '#dba872', '#c48c58', '#9c6a40'],
  floor: ['#e8bb86', '#d9a873', '#c99662', '#ae7c4c'],
  walnut: ['#a8684c', '#8a4e38', '#6c382a', '#4e2620'],
  lounge: ['#b8c494', '#a4b282', '#929f72', '#7c8a60'],
  corridor: ['#f0e6d4', '#e4d6c0', '#d4c4aa', '#b8a68c'],
  wallTop: ['#9c7a86', '#7e5e6c', '#664a58', '#4e3644'],
  wallFace: ['#fbf0dc', '#f2e2c6', '#e4d0b0', '#c8b08e'],
  baseboard: ['#b88a64', '#946a4a', '#74503a', '#583a2a'],
  void: '#2a2030',
  metal: ['#e4e0e8', '#bcb8c4', '#8e8a9a', '#646070'],
  dark: ['#5a5464', '#3e3a48', '#2e2a36', '#221e28'],
  screen: ['#c4f0f4', '#6cc8dc', '#3a94b8', '#24607e'],
  screenOff: ['#5a6270', '#3a4250', '#2a303c', '#1e222c'],
  leaf: ['#a8dc78', '#72b458', '#4a8a44', '#2e5e34'],
  pot: ['#f0a070', '#d4764a', '#a85434', '#7a3a24'],
  sofa: ['#ec9c78', '#d4785a', '#b05a44', '#864032'],
  armchair: ['#f4d07c', '#e2b056', '#c08e3e', '#94682c'],
  rug: ['#d87064', '#b8504a', '#923a3a', '#f2d6a8'],
  water: ['#d6f2fc', '#a4dcf2', '#6cb8e0', '#4a8cc0'],
  sky: ['#f0faff', '#c4e8f8', '#94cfee', '#6aaed8'],
  board: ['#ffffff', '#f2f4f6', '#d4d8de', '#a8aeb8'],
  paper: ['#fffcf2', '#f2ead6', '#d8ccb2', '#b4a68a'],
  bubble: ['#ff8a78', '#e44c4c', '#b02e3a'],
  select: ['#fff6b0', '#ffd84a', '#dca024'],
} as const;

export interface PixelImage {
  w: number;
  h: number;
  /** RGBA */
  data: Uint8ClampedArray;
  /** ancora in pixel: punto che va sulla cella (piedi o angolo) */
  ax: number;
  ay: number;
}

// ---------------------------------------------------------------------------------------------------------------
// raster

const rgbaCache = new Map<string, readonly [number, number, number, number]>();

/** '#rrggbb' o '#rrggbbaa' -> [r, g, b, a] */
export function rgba(hex: string): readonly [number, number, number, number] {
  let c = rgbaCache.get(hex);
  if (!c) {
    const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
    c = [n(1), n(3), n(5), hex.length > 7 ? n(7) : 255];
    rgbaCache.set(hex, c);
  }
  return c;
}

/** Tela di pixel con primitive minime; disegnare fuori dai bordi non fa nulla. */
class Raster {
  readonly data: Uint8ClampedArray;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint8ClampedArray(w * h * 4);
  }

  px(x: number, y: number, c: string | null | undefined): void {
    if (!c || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const [r, g, b, a] = rgba(c);
    const i = (y * this.w + x) * 4;
    this.data[i] = r;
    this.data[i + 1] = g;
    this.data[i + 2] = b;
    this.data[i + 3] = a;
  }

  rect(x: number, y: number, w: number, h: number, c: string | null | undefined): void {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.px(i, j, c);
  }

  hline(x0: number, x1: number, y: number, c: string): void {
    for (let i = Math.min(x0, x1); i <= Math.max(x0, x1); i++) this.px(i, y, c);
  }

  vline(x: number, y0: number, y1: number, c: string): void {
    for (let j = Math.min(y0, y1); j <= Math.max(y0, y1); j++) this.px(x, j, c);
  }

  opaque(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    return this.data[(y * this.w + x) * 4 + 3]! > 0;
  }

  /** ellisse piena con centro e semiassi (anche frazionari) */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: string): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.px(x, y, c);
      }
    }
  }

  /** Disegna una matrice di caratteri: ogni carattere passa da `color`; '.' e i caratteri senza colore restano. */
  stamp(rows: readonly string[], x: number, y: number, color: (ch: string) => string | null | undefined): void {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row.charAt(i);
        if (ch !== '.' && ch !== ' ') this.px(x + i, y + j, color(ch));
      }
    });
  }

  /** contorno di 1 px attorno alla sagoma (4-vicini): i pixel trasparenti che toccano un pixel pieno */
  outline(c: string): void {
    const edge: number[] = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.opaque(x, y)) continue;
        if (this.opaque(x - 1, y) || this.opaque(x + 1, y) || this.opaque(x, y - 1) || this.opaque(x, y + 1)) {
          edge.push(x, y);
        }
      }
    }
    for (let i = 0; i < edge.length; i += 2) this.px(edge[i]!, edge[i + 1]!, c);
  }

  image(ax: number, ay: number): PixelImage {
    return { w: this.w, h: this.h, data: this.data, ax, ay };
  }
}

/** specchia in orizzontale (l'ancora segue) */
export function mirrorImage(img: PixelImage): PixelImage {
  const data = new Uint8ClampedArray(img.data.length);
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const s = (y * img.w + x) * 4;
      const d = (y * img.w + (img.w - 1 - x)) * 4;
      data.set(img.data.subarray(s, s + 4), d);
    }
  }
  return { ...img, data, ax: img.w - img.ax };
}

/** hash deterministico di interi (variazioni di pavimenti e arredi) */
function hash2(x: number, z: number, salt = 0): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x1b873593);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return hash2(h, s.length, 7);
}

// ---------------------------------------------------------------------------------------------------------------
// personaggi

export type HairStyle = CharacterPreset['hairStyle'];
export type Accessory = CharacterPreset['accessory'];

export interface PixelLook {
  /** chiave stabile per la cache (id del preset) */
  id: string;
  skin: Ramp;
  hair: Ramp;
  hairStyle: HairStyle;
  beard: Ramp | null;
  shirt: Ramp;
  pants: Ramp;
  shoes: Ramp;
  /** cappellino e dettagli delle cuffie */
  accent: Ramp;
  accessory: Accessory;
  /** giacca aperta su camicia bianca e cravatta: il boss */
  jacket: boolean;
}

/** larghezza e altezza di un personaggio */
export const CHAR_W = 16;
export const CHAR_H = 24;

export const POSE_FRAMES: Record<Pose, number> = { stand: 2, walk: 4, sit: 2, type: 4 };

function dist2(a: string, b: string): number {
  const [r1, g1, b1] = rgba(a);
  const [r2, g2, b2] = rgba(b);
  return (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;
}

/** la rampa della palette con il tono base più vicino a `hex` */
function nearest(ramps: Record<string, Ramp>, hex: string): Ramp {
  let best: Ramp | null = null;
  let bestD = Infinity;
  for (const r of Object.values(ramps)) {
    const d = dist2(r[1], hex);
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best!;
}

const SHOES = Object.values(PALETTE.shoes);
const ACCENTS: readonly Ramp[] = [PALETTE.cloth.coral, PALETTE.cloth.teal, PALETTE.cloth.mustard, PALETTE.cloth.blue, PALETTE.cloth.rose];

function lookFromPreset(p: CharacterPreset, seed: number, jacket: boolean): PixelLook {
  const shirt = nearest(PALETTE.cloth, p.shirt);
  // accento diverso dalla camicia
  let accent = ACCENTS[seed % ACCENTS.length]!;
  if (accent === shirt) accent = ACCENTS[(seed + 1) % ACCENTS.length]!;
  return {
    id: p.id,
    skin: nearest(PALETTE.skin, p.skin),
    hair: nearest(PALETTE.hair, p.hair),
    hairStyle: p.hairStyle,
    beard: p.beard ? nearest(PALETTE.hair, p.beard) : null,
    shirt,
    pants: nearest(PALETTE.pants, p.pants),
    shoes: jacket ? PALETTE.shoes.black : SHOES[(seed >>> 3) % SHOES.length]!,
    accent,
    accessory: p.accessory,
    jacket,
  };
}

/** Deterministico, coerente con pickPreset della vista 3D: stessi capelli, pelle, vestiti e accessorio. */
export function pickLook(agentId: string): PixelLook {
  return lookFromPreset(pickPreset(agentId), hashString(agentId), false);
}

/** Claude stesso: calvo, barba prugna, cravatta e giacca arancio Claude (le altre sessioni cambiano colore). */
export function bossLook(index: number): PixelLook {
  return lookFromPreset(bossPreset(index), 0, true);
}

/** Testa 14 colonne (x 1..14), 10 righe dalla y 3; `top` sposta l'inizio (chignon, cappellino, cuffie). */
interface Stamp {
  top: number;
  rows: readonly string[];
}
type View = 'down' | 'up' | 'right';

const FACE_DOWN = [
  'SSSSESSSSESSsS',
  'sSSSESSSSESSss',
  '.sSbSSSSSSbSs.',
  '..sSSSmmSSSs..',
  '...ssssssss...',
];
const FACE_RIGHT = [
  '.HHHHsSSSSESS.',
  '.hHHHLsSSSESSS',
  '.hHHHSSSSSSbS.',
  '..hhHsSSSSSs..',
  '...hhsssssss..',
];
const NAPE_UP = [
  'SHHHHHHHHHHhhS',
  'sHHHHHHHHHHhhs',
  '.hHHHHHHHHHhh.',
  '..hhHHHHHhhh..',
  '...ssssssss...',
];

const HEADS: Record<HairStyle, Record<View, Stamp>> = {
  bald: {
    down: {
      top: 0,
      rows: ['...SSSSSSSS...', '..SLLSSSSSSS..', '.SLLSSSSSSSSs.', '.SLSSSSSSSSSs.', '.SSSSSSSSSSSs.', ...FACE_DOWN],
    },
    up: {
      top: 0,
      rows: [
        '...SSSSSSSS...',
        '..SLLSSSSSSS..',
        '.SLLSSSSSSSSs.',
        '.SLSSSSSSSSSs.',
        '.SSSSSSSSSSSs.',
        'SSSSSSSSSSSSsS',
        'sSSSSSSSSSSsss',
        '.sSSSSSSSSSss.',
        '..ssSSSSSsss..',
        '...ssssssss...',
      ],
    },
    right: {
      top: 0,
      rows: [
        '...SSSSSSSS...',
        '..SLLSSSSSSS..',
        '.SLLSSSSSSSSs.',
        '.SLSSSSSSSSSS.',
        '.SSSSSSSSSSSS.',
        '.SSSSsSSSSESS.',
        '.sSSLLsSSSESSS',
        '.sSSSsSSSSSbS.',
        '..sSSSSSSSSs..',
        '...ssssssss...',
      ],
    },
  },
  short: {
    down: {
      top: 0,
      rows: ['...HHHHHHHH...', '..HHGGHHHHHH..', '.HHGHHHHHHHHh.', '.HHHHHHHHHHHh.', '.HHhSShSSShHh.', ...FACE_DOWN],
    },
    up: {
      top: 0,
      rows: ['...HHHHHHHH...', '..HHGGHHHHHH..', '.HHGHHHHHHHHh.', '.HHHHHHHHHHHh.', '.HHHHHHHHHHHh.', ...NAPE_UP],
    },
    right: {
      top: 0,
      rows: ['...HHHHHHHH...', '..HHHHHGGGH...', '.HHHHHHHHHGHh.', '.HHHHHHHHHHHHh', '.HHHHHHSSShHH.', ...FACE_RIGHT],
    },
  },
  long: {
    down: {
      top: 0,
      rows: [
        '...HHHHHHHH...',
        '..HHGGHHHHHH..',
        '.HHGHHHHHHHHh.',
        '.HHHHHHHHHHHh.',
        '.HHHhSSSShHHh.',
        '.HHSESSSSESHh.',
        '.HhSESSSSESShh',
        '.HhbSSSSSSbhh.',
        '.hhsSSmmSSshh.',
        '.hh.ssssss.hh.',
        '.hh........hh.',
        '..h........h..',
      ],
    },
    up: {
      top: 0,
      rows: [
        '...HHHHHHHH...',
        '..HHGGHHHHHH..',
        '.HHGHHHHHHHHh.',
        '.HHHHHHHHHHHh.',
        '.HHHHHHHHHHHh.',
        '.HHHHHHHHHHHh.',
        '.HHHHHHHHHHHh.',
        '.hHHHHHHHHHhh.',
        '.hHHHHHHHHHhh.',
        '.hhHHHHHHHhhh.',
        '.hhhHHHHHhhhh.',
        '..hhhhhhhhhh..',
      ],
    },
    right: {
      top: 0,
      rows: [
        '...HHHHHHHH...',
        '..HHHHHGGGH...',
        '.HHHHHHHHHGHh.',
        '.HHHHHHHHHHHHh',
        '.HHHHHHSSShHH.',
        '.HHHHHsSSSESS.',
        '.HHHHHLsSSESSS',
        '.hHHHHSSSSSbS.',
        '.hHHHhsSSSSs..',
        '.hhHHhssssss..',
        '.hhhhh........',
        '..hhh.........',
      ],
    },
  },
  bun: {
    down: {
      top: -2,
      rows: [
        '.....HGGH.....',
        '....HHHHhh....',
        '...HHHHHHHH...',
        '..HHGGHHHHHH..',
        '.HHGHHHHHHHHh.',
        '.HHHHHHHHHHHh.',
        '.HhSSSSSSSShh.',
        ...FACE_DOWN,
      ],
    },
    up: {
      top: -2,
      rows: [
        '.....HGGH.....',
        '....HHHHhh....',
        '...HHhhhhHH...',
        '..HHGGHHHHHH..',
        '.HHGHHHHHHHHh.',
        '.HHHHHHHHHHHh.',
        '.HHHHHHHHHHHh.',
        ...NAPE_UP,
      ],
    },
    right: {
      top: -2,
      rows: [
        '..HGGH........',
        '.HHHHhh.......',
        '.hHHHHHHHHH...',
        '..HHHHHGGGH...',
        '.HHHHHHHHHGHh.',
        '.HHHHHHHHHHHHh',
        '.HHHHHHSSSSSH.',
        ...FACE_RIGHT,
      ],
    },
  },
  cap: {
    down: {
      top: -1,
      rows: [
        '....CCCCCC....',
        '...CCCCCCCC...',
        '..CCGCCCCCCc..',
        '.CCCCCCCCCCCc.',
        '.cVVVVVVVVVVc.',
        '.HHsssssssshH.',
        ...FACE_DOWN,
      ],
    },
    up: {
      top: -1,
      rows: [
        '....CCCCCC....',
        '...CCCCCCCC...',
        '..CCGCCCCCCc..',
        '.CCCCCCCCCCCc.',
        '.cCCCVVVCCCcc.',
        '.HHHHHHHHHHHh.',
        ...NAPE_UP,
      ],
    },
    right: {
      top: -1,
      rows: [
        '....CCCCCC....',
        '...CCCCCCCC...',
        '..CCCCCGCCCC..',
        '.CCCCCCCCCCCc.',
        '.cCCCCCCcVVVVV',
        '.HHHHHHssssSS.',
        ...FACE_RIGHT,
      ],
    },
  },
};

/** barba piena sulla metà inferiore del viso (la bocca resta visibile) */
const BEARD: Partial<Record<View, Stamp>> = {
  down: { top: 5, rows: ['.D..........D.', '.D..........D.', '.DDD......DDD.', '..DDDDMMDDDD..', '...DDDDDDDD...', '....dddddd....'] },
  right: { top: 5, rows: ['......D.......', '......D.......', '......DD...DD.', '......dDDDDMD.', '.......dDDDD..', '........ddd...'] },
};
const GLASSES: Partial<Record<View, Stamp>> = {
  down: { top: 5, rows: ['...KEgKKgEK...'] },
  right: { top: 5, rows: ['......KKKgEK..'] },
};
const HEADSET: Record<View, Stamp> = {
  down: { top: -1, rows: ['...PPPPPPPP...', '..P........P..', '.P..........P.', '.P..........P.', '', 'PA..........AP', 'PA..........AP', 'pp..........pp'] },
  up: { top: -1, rows: ['...PPPPPPPP...', '..P........P..', '.P..........P.', '.P..........P.', '', 'PA..........AP', 'PA..........AP', 'pp..........pp'] },
  right: { top: -1, rows: ['.....PP.......', '.....P........', '.....P........', '.....P........', '.....P........', '....PAP.......', '....PAP.......', '....ppp.......'] },
};

function headColor(look: PixelLook, ch: string): string | undefined {
  switch (ch) {
    case 'S': return look.skin[1];
    case 's':
    case 'm':
    case 'b': return look.skin[2];
    case 'L': return look.skin[0];
    case 'E':
    case 'K':
    case 'M': return PALETTE.outline;
    case 'g': return PALETTE.glass;
    case 'H': return look.hair[1];
    case 'h': return look.hair[2];
    case 'G': return look.hair[0];
    case 'C': return look.accent[1];
    case 'c':
    case 'V': return look.accent[2];
    case 'D': return (look.beard ?? look.hair)[1];
    case 'd': return (look.beard ?? look.hair)[2];
    case 'P': return PALETTE.headset[1];
    case 'p': return PALETTE.headset[2];
    case 'A': return look.accent[1];
    default: return undefined;
  }
}

/** testa con capelli, barba e accessori; (0, y) è l'angolo della matrice da 14 colonne */
function drawHead(r: Raster, look: PixelLook, view: View, y: number): void {
  const col = (ch: string) => headColor(look, ch);
  const head = HEADS[look.hairStyle][view];
  r.stamp(head.rows, 1, y + head.top, col);
  const beard = look.beard ? BEARD[view] : undefined;
  if (beard) r.stamp(beard.rows, 1, y + beard.top, col);
  if (look.accessory === 'glasses') {
    const g = GLASSES[view];
    if (g) r.stamp(g.rows, 1, y + g.top, col);
  }
  if (look.accessory === 'headphones') {
    const h = HEADSET[view];
    r.stamp(h.rows, 1, y + h.top, col);
  }
}

interface Leg {
  /** colonna dell'anca e del piede (2 px di larghezza) */
  hip: number;
  foot: number;
  /** piede sollevato di n px */
  lift: number;
}

/** Corpo visto di fronte o di spalle; t = prima riga del busto. */
function drawBodyFront(
  r: Raster,
  look: PixelLook,
  back: boolean,
  t: number,
  opts: { hands: [number, number]; seated: boolean; typing: number | null; lift: [number, number] },
): void {
  const { shirt, pants, skin, shoes } = look;
  // gambe e scarpe
  if (opts.seated) {
    if (back) {
      r.rect(4, t + 5, 8, 2, pants[2]);
      r.hline(4, 11, t + 5, pants[1]);
    } else {
      // cosce verso chi guarda, piedi sotto
      r.rect(4, t + 5, 8, 2, pants[1]);
      r.hline(4, 11, t + 5, pants[0]);
      r.px(7, t + 6, pants[2]);
      r.px(8, t + 6, pants[2]);
      r.rect(4, t + 7, 3, 1, shoes[1]);
      r.rect(9, t + 7, 3, 1, shoes[1]);
    }
  } else {
    r.rect(4, t + 5, 8, 1, pants[1]);
    ([[5, opts.lift[0]], [9, opts.lift[1]]] as const).forEach(([x, lift]) => {
      const foot = 22 - lift;
      for (let y = t + 6; y < foot; y++) {
        r.px(x, y, pants[1]);
        r.px(x + 1, y, pants[2]);
      }
      const sx = x === 5 ? 4 : 9;
      r.rect(sx, foot, 3, 1, shoes[1]);
      if (!back) r.px(sx + (x === 5 ? 0 : 2), foot, shoes[0]);
    });
  }
  // busto
  r.rect(4, t, 8, 5, shirt[1]);
  r.vline(4, t, t + 3, shirt[0]);
  r.vline(11, t, t + 4, shirt[2]);
  r.hline(4, 11, t + 4, shirt[2]);
  if (!back) {
    if (look.jacket) {
      // giacca aperta: camicia bianca a V e cravatta
      r.rect(6, t, 4, 2, PALETTE.cloth.white[1]);
      r.hline(7, 8, t + 2, PALETTE.cloth.white[1]);
      r.px(5, t, shirt[0]);
      r.px(10, t, shirt[0]);
    } else {
      r.px(7, t, skin[2]);
      r.px(8, t, skin[2]);
    }
    if (look.accessory === 'tie' || look.jacket) {
      r.px(7, t, PALETTE.tie[1]);
      r.px(8, t, PALETTE.tie[1]);
      r.vline(7, t + 1, t + 3, PALETTE.tie[1]);
      r.vline(8, t + 1, t + 3, PALETTE.tie[2]);
    }
  } else if (look.jacket) {
    r.vline(7, t + 1, t + 4, shirt[2]);
  }
  // braccia: mani alla riga t+4 o una più su (oscillazione); digitando restano in avanti
  ([[3, opts.hands[0], shirt[back ? 2 : 0]], [12, opts.hands[1], shirt[2]]] as const).forEach(([x, dy, c]) => {
    if (opts.typing !== null) {
      r.vline(x, t, t + 2 - dy, c);
      if (!back) r.rect(x === 3 ? 5 : 9, t + 3 - dy, 2, 1, skin[1]);
      return;
    }
    r.vline(x, t, t + 3 + dy, c);
    r.px(x, t + 4 + dy, skin[back ? 2 : 1]);
  });
}

function drawLegSide(r: Raster, look: PixelLook, top: number, leg: Leg, near: boolean): void {
  const pants = look.pants;
  const foot = 22 - leg.lift;
  const n = Math.max(1, foot - 1 - top);
  for (let y = top; y < foot; y++) {
    const x = Math.round(leg.hip + ((leg.foot - leg.hip) * (y - top)) / n);
    r.px(x, y, near ? pants[1] : pants[2]);
    r.px(x + 1, y, near ? pants[1] : pants[2]);
  }
  const sh = look.shoes;
  r.rect(leg.foot, foot, 3, 1, near ? sh[1] : sh[2]);
  if (near) r.px(leg.foot + 2, foot, sh[0]);
}

/** Corpo di profilo, rivolto a destra. */
function drawBodySide(
  r: Raster,
  look: PixelLook,
  t: number,
  opts: { swing: number; seated: boolean; typing: number | null; legs: [Leg, Leg] },
): void {
  const { shirt, pants, skin } = look;
  if (opts.seated) {
    // coscia in avanti, polpaccio giù
    r.rect(5, t + 5, 7, 2, pants[1]);
    r.hline(5, 11, t + 5, pants[0]);
    r.rect(10, t + 7, 2, 22 - t - 7, pants[1]);
    r.rect(10, 22, 3, 1, look.shoes[1]);
    r.px(12, 22, look.shoes[0]);
  } else {
    r.rect(5, t + 5, 6, 1, pants[1]);
    drawLegSide(r, look, t + 6, opts.legs[1], false);
    drawLegSide(r, look, t + 6, opts.legs[0], true);
  }
  r.rect(5, t, 6, 5, shirt[1]);
  r.vline(5, t, t + 3, shirt[0]);
  r.hline(5, 10, t + 4, shirt[2]);
  if (look.jacket) {
    r.rect(9, t, 2, 2, PALETTE.cloth.white[1]);
    r.vline(10, t, t + 3, PALETTE.tie[1]);
  } else if (look.accessory === 'tie') {
    r.vline(10, t + 1, t + 3, PALETTE.tie[1]);
  }
  // braccio vicino
  if (opts.typing !== null) {
    r.rect(7, t, 2, 2, shirt[2]);
    r.rect(9, t + 2, 2, 1, shirt[2]);
    r.rect(11, t + 2 - opts.typing, 2, 1, skin[1]);
  } else if (opts.swing > 0) {
    r.rect(7, t, 2, 2, shirt[2]);
    r.rect(8, t + 2, 2, 1, shirt[2]);
    r.rect(9, t + 3, 2, 1, skin[1]);
  } else if (opts.swing < 0) {
    r.rect(7, t, 2, 2, shirt[2]);
    r.rect(6, t + 2, 2, 1, shirt[2]);
    r.rect(5, t + 3, 2, 1, skin[1]);
  } else {
    r.rect(7, t, 2, 4, shirt[2]);
    r.rect(7, t + 4, 2, 1, skin[1]);
  }
}

/**
 * Personaggio 16×24 ancorato ai piedi (ax, ay = centro della base). `frame` gira modulo POSE_FRAMES[pose].
 * stand: respiro; walk: passo in 4 tempi; sit: seduto (da dietro se guarda in su, verso la scrivania); type: seduto
 * che digita.
 */
export function characterImage(look: PixelLook, pose: Pose, facing: Facing, frame: number): PixelImage {
  if (facing === 'left') return mirrorImage(characterImage(look, pose, 'right', frame));
  const n = POSE_FRAMES[pose];
  const f = ((Math.trunc(frame) % n) + n) % n;
  const r = new Raster(CHAR_W, CHAR_H);
  const seated = pose === 'sit' || pose === 'type';
  // spostamento verticale del corpo (seduto più in basso, passo che rimbalza) e della sola testa (respiro)
  const bob = pose === 'walk' && f % 2 === 1 ? -1 : 0;
  const body = (seated ? 2 : 0) + bob;
  const breath = (pose === 'stand' || pose === 'sit') && f === 1 ? 1 : 0;
  const typing = pose === 'type' ? [0, 1, 0, 1][f]! : null;
  const t = 13 + body;
  const view: View = facing === 'right' ? 'right' : facing;

  if (view === 'right') {
    const stride: [Leg, Leg][] = [
      [{ hip: 7, foot: 9, lift: 0 }, { hip: 6, foot: 4, lift: 0 }],
      [{ hip: 7, foot: 7, lift: 0 }, { hip: 6, foot: 5, lift: 1 }],
      [{ hip: 6, foot: 4, lift: 0 }, { hip: 7, foot: 9, lift: 0 }],
      [{ hip: 7, foot: 6, lift: 1 }, { hip: 6, foot: 7, lift: 0 }],
    ];
    const legs: [Leg, Leg] = pose === 'walk' ? stride[f]! : [{ hip: 7, foot: 7, lift: 0 }, { hip: 6, foot: 6, lift: 0 }];
    const swing = pose === 'walk' ? [-1, 0, 1, 0][f]! : 0;
    // braccio lontano dietro il busto mentre cammina
    if (pose === 'walk' && swing !== 0) {
      r.rect(swing > 0 ? 5 : 9, t + 3, 2, 1, look.skin[2]);
    }
    drawBodySide(r, look, t, { swing, seated, typing, legs });
  } else {
    const back = view === 'up';
    const lift: [number, number] = pose === 'walk' ? ([[1, 0], [0, 0], [0, 1], [0, 0]] as const)[f]!.slice() as [number, number] : [0, 0];
    const hands: [number, number] =
      pose === 'walk' ? (([[-1, 0], [0, 0], [0, -1], [0, 0]] as const)[f]!.slice() as [number, number])
      : typing !== null ? (f % 2 === 0 ? [typing, 0] : [0, typing])
      : [0, 0];
    drawBodyFront(r, look, back, t, { hands, seated, typing, lift });
  }
  drawHead(r, look, view, 3 + body + breath);
  r.outline(PALETTE.outline);
  return r.image(CHAR_W / 2, CHAR_H - 1);
}

// ---------------------------------------------------------------------------------------------------------------
// arredi

type Color4 = Ramp4;

/**
 * Parallelepipedo a 3/4: impronta (x, fy, w, d) sul pavimento, alto `hgt` px. Il piano sale di `hgt`, il fronte
 * scende fino al bordo sud dell'impronta.
 */
function box(r: Raster, x: number, fy: number, w: number, d: number, hgt: number, top: Color4, front: Color4): void {
  const ty = fy - hgt;
  r.rect(x, ty, w, d, top[1]);
  r.hline(x, x + w - 1, ty, top[0]);
  r.rect(x, ty + d, w, hgt, front[2]);
  r.hline(x, x + w - 1, ty + d, front[1]);
  r.hline(x, x + w - 1, ty + d + hgt - 1, front[3]);
}

/** tela per un arredo w×h celle con `extra` px sopra l'impronta (l'altezza dell'oggetto) */
function furnitureRaster(w: number, h: number, extra: number): { r: Raster; W: number; D: number; E: number } {
  const W = w * TILE;
  const D = h * TILE;
  return { r: new Raster(W, D + extra), W, D, E: extra };
}

function finish(r: Raster, E: number, outline = true): PixelImage {
  if (outline) r.outline(PALETTE.outline);
  return r.image(0, E);
}

function desk(w: number, h: number, boss: boolean): PixelImage {
  const { r, W, D, E } = furnitureRaster(w, h, 8);
  const wood = boss ? PALETTE.walnut : PALETTE.wood;
  const hgt = 7;
  const fy = E + 1;
  const d = D - 2;
  const ty = fy - hgt;
  // piano con venature
  r.rect(1, ty, W - 2, d, wood[1]);
  r.hline(1, W - 2, ty, wood[0]);
  r.vline(1, ty, ty + d - 1, wood[0]);
  for (let i = 0; i < W / 8; i++) {
    const gx = 3 + ((hash2(i, W, 3) % (W - 8)) | 0);
    const gy = ty + 2 + (hash2(i, D, 4) % Math.max(1, d - 4));
    r.hline(gx, gx + 2 + (i % 3), gy, wood[2]);
  }
  r.hline(1, W - 2, ty + d - 1, wood[2]);
  // fronte: fascia, gambe e cassettiera a destra
  const fy0 = ty + d;
  r.rect(1, fy0, W - 2, 2, wood[2]);
  r.rect(1, fy0 + 2, 2, hgt - 2, wood[2]);
  r.rect(W - 3, fy0 + 2, 2, hgt - 2, wood[2]);
  const dw = Math.min(10, W - 8);
  r.rect(W - 3 - dw, fy0, dw, hgt, wood[2]);
  r.hline(W - 3 - dw, W - 3, fy0 + 3, wood[3]);
  r.px(W - 3 - dw / 2, fy0 + 1, wood[0]);
  r.px(W - 3 - dw / 2, fy0 + 5, wood[0]);
  r.hline(1, W - 2, fy0, wood[3]);
  if (boss) {
    // targhetta e lampada da tavolo
    r.rect(3, ty + 2, 6, 3, PALETTE.paper[1]);
    r.hline(4, 7, ty + 3, PALETTE.paper[3]);
    r.rect(W - 8, ty + 1, 3, 3, PALETTE.cloth.claude[1]);
    r.px(W - 8, ty + 1, PALETTE.cloth.claude[0]);
    r.px(W - 7, ty + 4, PALETTE.dark[1]);
  } else {
    // fogli e una tazza
    r.rect(3, ty + 3, 5, 4, PALETTE.paper[0]);
    r.hline(4, 6, ty + 4, PALETTE.paper[2]);
    r.hline(4, 5, ty + 5, PALETTE.paper[2]);
    r.rect(W - 6, ty + 2, 2, 2, PALETTE.cloth.white[1]);
    r.px(W - 6, ty + 2, PALETTE.dark[1]);
  }
  return finish(r, E);
}

function chair(facing: Facing): PixelImage {
  const { r, E } = furnitureRaster(1, 1, 10);
  const seat = PALETTE.dark;
  const leg = (x: number) => {
    r.vline(x, E + 9, E + 12, PALETTE.metal[2]);
  };
  if (facing === 'left' || facing === 'right') {
    // di profilo, schienale sul lato opposto allo sguardo (disegno verso destra e poi specchio)
    leg(7);
    r.hline(4, 11, E + 13, PALETTE.metal[3]);
    box(r, 4, E + 6, 8, 5, 4, seat, seat);
    r.rect(3, E - 4, 3, 13, seat[2]);
    r.vline(3, E - 4, E + 7, seat[1]);
    r.hline(3, 5, E - 4, seat[0]);
    const img = finish(r, E);
    return facing === 'left' ? { ...mirrorImage(img), ax: 0 } : img;
  }
  leg(7);
  leg(8);
  r.hline(4, 11, E + 13, PALETTE.metal[3]);
  if (facing === 'down') {
    // schienale dietro (a nord), seduta davanti
    r.rect(4, E - 6, 8, 9, seat[1]);
    r.hline(4, 11, E - 6, seat[0]);
    r.vline(4, E - 6, E + 2, seat[0]);
    r.vline(11, E - 5, E + 2, seat[2]);
    box(r, 3, E + 6, 10, 5, 4, seat, seat);
  } else {
    // visto da dietro: seduta e schienale verso chi guarda
    box(r, 3, E + 3, 10, 5, 4, seat, seat);
    r.rect(4, E - 3, 8, 11, seat[2]);
    r.hline(4, 11, E - 3, seat[1]);
    r.vline(4, E - 3, E + 7, seat[1]);
    r.rect(7, E + 8, 2, 2, PALETTE.metal[2]);
  }
  return finish(r, E);
}

/** monitor con tastiera; schermo rivolto a `facing`; frame < 0 = spento */
function monitor(facing: Facing, frame: number): PixelImage {
  const { r, E } = furnitureRaster(1, 1, 8);
  const base = E + 6;
  const frameC = PALETTE.dark;
  if (facing === 'left' || facing === 'right') {
    r.rect(6, base, 5, 1, frameC[1]);
    r.rect(7, base - 3, 2, 3, frameC[2]);
    r.rect(6, base - 12, 3, 10, frameC[1]);
    r.vline(8, base - 12, base - 3, frameC[0]);
    const img = finish(r, E);
    return facing === 'left' ? { ...mirrorImage(img), ax: 0 } : img;
  }
  r.rect(5, base, 6, 1, frameC[1]);
  r.rect(7, base - 3, 2, 3, frameC[2]);
  r.rect(2, base - 12, 12, 10, frameC[1]);
  r.hline(2, 13, base - 12, frameC[0]);
  if (facing === 'up') {
    r.rect(3, base - 11, 10, 8, frameC[2]);
    r.rect(6, base - 9, 4, 3, frameC[3]);
    return finish(r, E);
  }
  const on = frame >= 0;
  const sc = on ? PALETTE.screen : PALETTE.screenOff;
  r.rect(3, base - 11, 10, 7, sc[2]);
  if (on) {
    // righe di codice che scorrono
    const lines = [
      [0, 5, PALETTE.screen[0]],
      [2, 3, PALETTE.cloth.mustard[0]],
      [2, 6, PALETTE.screen[1]],
      [0, 4, PALETTE.cloth.salmon[0]],
      [2, 5, PALETTE.screen[0]],
      [0, 3, PALETTE.cloth.mint[0]],
    ] as const;
    const off = frame % 2;
    for (let i = 0; i < 3; i++) {
      const [x, len, c] = lines[(i + off * 2) % lines.length]!;
      r.hline(4 + x, 4 + x + len - 1, base - 10 + i * 2, c);
    }
    if (off === 1) r.px(10, base - 6, PALETTE.screen[0]);
  } else {
    r.px(10, base - 10, sc[0]);
    r.px(11, base - 10, sc[0]);
    r.px(11, base - 9, sc[0]);
  }
  r.hline(3, 12, base - 4, sc[3]);
  // tastiera davanti allo schermo
  r.rect(3, base + 2, 10, 3, PALETTE.metal[1]);
  r.hline(3, 12, base + 2, PALETTE.metal[0]);
  for (let x = 4; x <= 11; x += 2) r.px(x, base + 3, PALETTE.metal[2]);
  r.hline(4, 11, base + 4, PALETTE.metal[2]);
  return finish(r, E);
}

function plant(): PixelImage {
  const { r, E } = furnitureRaster(1, 1, 14);
  const pot = PALETTE.pot;
  const leaf = PALETTE.leaf;
  box(r, 4, E + 9, 8, 4, 8, pot, pot);
  r.hline(3, 12, E - 1, pot[1]);
  // fogliame a ciuffi
  const tufts = [[8, E - 6, 5, 4.5], [5, E - 3, 3.5, 3], [11, E - 3, 3.5, 3], [8, E - 10, 3.5, 3.5], [8, E - 1, 4, 2.5]] as const;
  for (const [cx, cy, rx, ry] of tufts) r.ellipse(cx, cy + 1, rx, ry, leaf[3]);
  for (const [cx, cy, rx, ry] of tufts) r.ellipse(cx, cy, rx - 0.5, ry - 0.5, leaf[2]);
  for (const [cx, cy, rx, ry] of tufts) r.ellipse(cx - 1, cy - 1, rx - 2, ry - 1.5, leaf[1]);
  r.px(6, E - 9, leaf[0]);
  r.px(7, E - 12, leaf[0]);
  r.px(4, E - 4, leaf[0]);
  r.px(10, E - 6, leaf[0]);
  return finish(r, E);
}

/** divano o poltrona: schienale dal lato opposto allo sguardo di chi siede */
function sofa(w: number, h: number, facing: Facing, fabric: Color4): PixelImage {
  if (facing === 'left') return { ...mirrorImage(sofa(w, h, 'right', fabric)), ax: 0 };
  const { r, W, D, E } = furnitureRaster(w, h, 10);
  const seams = (x0: number, x1: number, y0: number, y1: number, vertical: boolean) => {
    if (vertical) for (let x = x0 + 16; x < x1; x += 16) r.vline(x, y0, y1, fabric[2]);
    else for (let y = y0 + 16; y < y1; y += 16) r.hline(x0, x1, y, fabric[2]);
  };
  if (facing === 'down') {
    box(r, 1, E + 2, W - 2, 4, 10, fabric, fabric);
    box(r, 3, E + 6, W - 6, D - 8, 5, fabric, fabric);
    seams(3, W - 4, E + 1, E + D - 8, true);
    box(r, 1, E + 4, 3, D - 6, 7, fabric, fabric);
    box(r, W - 4, E + 4, 3, D - 6, 7, fabric, fabric);
  } else if (facing === 'up') {
    box(r, 1, E + 1, 3, D - 6, 7, fabric, fabric);
    box(r, W - 4, E + 1, 3, D - 6, 7, fabric, fabric);
    box(r, 3, E + 1, W - 6, D - 7, 5, fabric, fabric);
    box(r, 1, E + D - 6, W - 2, 4, 10, fabric, fabric);
    seams(1, W - 2, E - 6, E + D - 3, true);
  } else {
    box(r, 4, E + 3, W - 6, D - 6, 5, fabric, fabric);
    seams(4, W - 3, E - 2, E + D - 8, false);
    box(r, 1, E + 1, 4, D - 3, 10, fabric, fabric);
    box(r, 4, E + 1, W - 5, 3, 7, fabric, fabric);
    box(r, 4, E + D - 5, W - 5, 3, 7, fabric, fabric);
  }
  return finish(r, E);
}

function coffeeTable(w: number, h: number): PixelImage {
  const { r, W, D, E } = furnitureRaster(w, h, 5);
  const wood = PALETTE.wood;
  box(r, 2, E + 2, W - 4, D - 6, 5, wood, wood);
  const ty = E - 3;
  r.rect(4, ty + 2, 5, 4, PALETTE.cloth.blue[0]);
  r.hline(5, 7, ty + 3, PALETTE.cloth.blue[2]);
  r.rect(W - 8, ty + 3, 3, 3, PALETTE.cloth.white[0]);
  r.px(W - 7, ty + 4, PALETTE.walnut[2]);
  r.px(W - 5, ty + 4, PALETTE.cloth.white[2]);
  return finish(r, E);
}

function coffeeMachine(w: number, h: number): PixelImage {
  const { r, W, E } = furnitureRaster(w, h, 22);
  const wood = PALETTE.wood;
  box(r, 1, E + 2, W - 2, 8, 12, wood, wood);
  const ty = E - 10;
  // anta del mobile
  r.vline(W / 2, ty + 9, ty + 20, wood[3]);
  // macchina sul piano: tramoggia dei chicchi, display, erogatore con tazzina
  box(r, 3, ty + 5, 8, 3, 11, PALETTE.metal, PALETTE.dark);
  r.rect(5, ty - 9, 4, 4, PALETTE.walnut[1]);
  r.hline(5, 8, ty - 9, PALETTE.walnut[0]);
  r.px(6, ty - 7, PALETTE.walnut[3]);
  r.px(4, ty - 2, PALETTE.bubble[1]);
  r.hline(7, 9, ty - 2, PALETTE.screen[1]);
  r.rect(5, ty, 4, 4, PALETTE.dark[3]);
  r.hline(6, 7, ty, PALETTE.metal[2]);
  r.rect(6, ty + 2, 2, 2, PALETTE.cloth.white[0]);
  // tazze accanto
  r.rect(W - 4, ty + 2, 2, 2, PALETTE.cloth.white[0]);
  r.rect(W - 4, ty + 5, 2, 2, PALETTE.cloth.coral[1]);
  return finish(r, E);
}

function waterCooler(w: number, h: number): PixelImage {
  const { r, W, E } = furnitureRaster(w, h, 24);
  const cx = Math.floor(W / 2);
  box(r, cx - 5, E + 3, 10, 6, 14, PALETTE.board, PALETTE.board);
  const ty = E - 11;
  r.rect(cx - 2, ty + 4, 4, 2, PALETTE.metal[2]);
  r.px(cx - 2, ty + 5, PALETTE.bubble[1]);
  r.px(cx + 1, ty + 5, PALETTE.cloth.blue[1]);
  // bottiglione
  r.rect(cx - 4, ty - 10, 8, 10, PALETTE.water[1]);
  r.rect(cx - 3, ty - 12, 6, 2, PALETTE.water[1]);
  r.vline(cx - 3, ty - 10, ty - 2, PALETTE.water[0]);
  r.vline(cx + 3, ty - 10, ty - 1, PALETTE.water[2]);
  r.hline(cx - 4, cx + 3, ty - 6, PALETTE.water[2]);
  r.rect(cx - 1, ty - 13, 2, 1, PALETTE.water[3]);
  r.hline(cx - 4, cx + 3, ty - 1, PALETTE.water[3]);
  return finish(r, E);
}

const BOOK_COLORS: readonly Ramp[] = [
  PALETTE.cloth.coral, PALETTE.cloth.teal, PALETTE.cloth.mustard, PALETTE.cloth.blue,
  PALETTE.cloth.violet, PALETTE.cloth.lime, PALETTE.cloth.rose, PALETTE.cloth.sand,
];

function bookshelf(w: number, h: number, facing: Facing): PixelImage {
  const { r, W, E } = furnitureRaster(w, h, 22);
  const wood = PALETTE.walnut;
  if (facing === 'up') {
    box(r, 1, E + 1, W - 2, 6, 22, wood, wood);
    return finish(r, E);
  }
  box(r, 1, E + 1, W - 2, 5, 22, wood, wood);
  const fy = E + 1 - 22 + 5;
  // tre ripiani di libri colorati
  for (let s = 0; s < 3; s++) {
    const y0 = fy + 2 + s * 7;
    r.rect(3, y0, W - 6, 5, wood[3]);
    let x = 3;
    while (x < W - 3) {
      const hsh = hash2(x, s, W);
      const bw = 1 + (hsh % 2);
      const bh = 3 + ((hsh >>> 3) % 3);
      if (hsh % 9 === 0) {
        x += 2;
        continue;
      }
      const c = BOOK_COLORS[(hsh >>> 5) % BOOK_COLORS.length]!;
      const ww = Math.min(bw, W - 3 - x);
      r.rect(x, y0 + 5 - bh, ww, bh, c[1]);
      r.px(x, y0 + 5 - bh, c[0]);
      if (ww > 1) r.vline(x + 1, y0 + 6 - bh, y0 + 4, c[2]);
      x += ww;
    }
    r.hline(2, W - 3, y0 + 5, wood[1]);
  }
  return finish(r, E);
}

function rug(w: number, h: number): PixelImage {
  const { r, W, D } = furnitureRaster(w, h, 0);
  const c = PALETTE.rug;
  r.rect(1, 1, W - 2, D - 2, c[1]);
  r.rect(3, 3, W - 6, D - 6, c[2]);
  r.rect(4, 4, W - 8, D - 8, c[1]);
  // motivo a rombi chiari
  for (let y = 6; y < D - 6; y += 4) {
    for (let x = 6 + ((y / 4) % 2) * 2; x < W - 6; x += 4) r.px(x, y, c[3]);
  }
  for (let x = 2; x < W - 2; x += 2) {
    r.px(x, 2, c[3]);
    r.px(x, D - 3, c[3]);
  }
  for (let y = 2; y < D - 2; y += 2) {
    r.px(2, y, c[3]);
    r.px(W - 3, y, c[3]);
  }
  return finish(r, 0);
}

function whiteboard(w: number, h: number): PixelImage {
  const { r, W, E } = furnitureRaster(w, h, 20);
  const frame = PALETTE.metal;
  // gambe e lavagna
  r.rect(3, E - 4, 2, 10, frame[2]);
  r.rect(W - 5, E - 4, 2, 10, frame[2]);
  r.rect(1, 1, W - 2, E - 3, frame[1]);
  r.hline(1, W - 2, 1, frame[0]);
  r.rect(2, 2, W - 4, E - 6, PALETTE.board[1]);
  r.hline(2, W - 3, 2, PALETTE.board[0]);
  r.hline(1, W - 2, E - 3, frame[3]);
  // scritte e post-it
  const notes = [PALETTE.cloth.mustard, PALETTE.cloth.salmon, PALETTE.cloth.mint, PALETTE.cloth.blue];
  for (let x = 4, i = 0; x + 4 < W - 3; x += 7, i++) {
    r.hline(x, x + 4, 5, PALETTE.cloth.blue[1]);
    r.hline(x, x + 2, 7, PALETTE.cloth.steel[1]);
    const n = notes[i % notes.length]!;
    r.rect(x + 1, 10, 3, 3, n[1]);
    r.px(x + 1, 10, n[0]);
  }
  r.rect(W - 9, E - 4, 4, 1, PALETTE.bubble[1]);
  return finish(r, E);
}

function windowSprite(w: number, h: number): PixelImage {
  const { r, W } = furnitureRaster(w, h, 0);
  const sky = PALETTE.sky;
  const frame = PALETTE.board;
  r.rect(2, 3, W - 4, 10, frame[2]);
  r.rect(3, 4, W - 6, 8, sky[2]);
  r.rect(3, 4, W - 6, 3, sky[1]);
  // riflessi diagonali
  for (let x = 4; x < W - 4; x += 8) {
    r.px(x + 2, 5, sky[0]);
    r.px(x + 1, 6, sky[0]);
    r.px(x, 7, sky[0]);
  }
  // montante al centro di ogni cella
  for (let x = TILE / 2; x < W; x += TILE) r.vline(x, 4, 11, frame[1]);
  r.hline(1, W - 2, 13, PALETTE.wood[1]);
  r.hline(1, W - 2, 14, PALETTE.wood[3]);
  return finish(r, 0);
}

/** sprite da una cella al centro di un'impronta w×h (stessa altezza sopra l'impronta) */
function centered(img: PixelImage, w: number, h: number): PixelImage {
  if (w === 1 && h === 1) return img;
  const r = new Raster(w * TILE, h * TILE + img.ay);
  const ox = ((w - 1) * TILE) / 2;
  const oy = ((h - 1) * TILE) / 2;
  for (let y = 0; y < img.h; y++) r.data.set(img.data.subarray(y * img.w * 4, (y + 1) * img.w * 4), ((y + oy) * r.w + ox) * 4);
  return r.image(0, img.ay);
}

/** frame di animazione degli arredi che ne hanno (monitor: schermo che cambia) */
export const FURNITURE_FRAMES: Partial<Record<FurnitureKind, number>> = { monitor: 2 };

/**
 * Arredo w×h celle. L'immagine è larga w·TILE e alta h·TILE più l'altezza dell'oggetto: l'ancora (0, ay) è l'angolo
 * nord-ovest dell'impronta. `facing` è il lato del fronte: dove guarda chi siede (sedia, divano, poltrona), dove è
 * rivolto lo schermo (monitor), il fronte di libreria e lavagna. Monitor: frame >= 0 acceso (2 fotogrammi), < 0 spento.
 */
export function furnitureImage(kind: FurnitureKind, facing: Facing, w: number, h: number, frame = 0): PixelImage {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  switch (kind) {
    case 'desk': return desk(w, h, false);
    case 'boss-desk': return desk(w, h, true);
    case 'chair': return centered(chair(facing), w, h);
    case 'monitor': return centered(monitor(facing, frame), w, h);
    case 'plant': return centered(plant(), w, h);
    case 'sofa': return sofa(w, h, facing, PALETTE.sofa);
    case 'armchair': return sofa(w, h, facing, PALETTE.armchair);
    case 'coffee-table': return coffeeTable(w, h);
    case 'coffee-machine': return coffeeMachine(w, h);
    case 'water-cooler': return waterCooler(w, h);
    case 'bookshelf': return bookshelf(w, h, facing);
    case 'rug': return rug(w, h);
    case 'whiteboard': return whiteboard(w, h);
    case 'window': return windowSprite(w, h);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// tile

/** altezza della cimasa delle pareti con la faccia visibile */
export const WALL_CAP = 4;

function parquet(r: Raster, x: number, z: number, wood: Color4): void {
  for (let row = 0; row < 4; row++) {
    const y = row * 4;
    const seam = (hash2(x, z * 4 + row, 11) % 12) + 2;
    for (let part = 0; part < 2; part++) {
      const x0 = part === 0 ? 0 : seam;
      const x1 = part === 0 ? seam - 1 : 15;
      const tone = hash2(x * 2 + part, z * 4 + row, 12) % 3 === 0 ? wood[0] : wood[1];
      r.rect(x0, y, x1 - x0 + 1, 3, tone);
      const g = hash2(x, z * 8 + row * 2 + part, 13);
      if (g % 2 === 0 && x1 - x0 > 4) r.hline(x0 + 1 + (g % (x1 - x0 - 3)), x0 + 2 + (g % (x1 - x0 - 3)), y + 1, wood[2]);
    }
    r.hline(0, 15, y + 3, wood[3]);
    r.px(seam - 1, y, wood[2]);
    r.px(seam - 1, y + 1, wood[2]);
    r.px(seam - 1, y + 2, wood[2]);
  }
}

/** Cella 16×16 ancorata all'angolo nord-ovest; piccole variazioni deterministiche in base a x, z. */
export function tileImage(kind: TileKind, x: number, z: number, faceVisible: boolean): PixelImage {
  const r = new Raster(TILE, TILE);
  switch (kind) {
    case 'void':
      r.rect(0, 0, TILE, TILE, PALETTE.void);
      break;
    case 'floor':
      parquet(r, x, z, PALETTE.floor);
      break;
    case 'lounge': {
      // moquette con trama fine
      const c = PALETTE.lounge;
      r.rect(0, 0, TILE, TILE, c[1]);
      for (let j = 0; j < TILE; j++) {
        for (let i = 0; i < TILE; i++) {
          const v = hash2(x * TILE + i, z * TILE + j, 21) % 16;
          if (v === 0) r.px(i, j, c[0]);
          else if (v < 3) r.px(i, j, c[2]);
          else if ((i + j) % 4 === 0) r.px(i, j, c[2]);
        }
      }
      break;
    }
    case 'corridor': {
      // piastrelle 8×8 con fughe
      const c = PALETTE.corridor;
      for (let q = 0; q < 4; q++) {
        const qx = (q % 2) * 8;
        const qy = Math.floor(q / 2) * 8;
        const tone = hash2(x * 2 + (q % 2), z * 2 + Math.floor(q / 2), 31) % 4 === 0 ? c[0] : c[1];
        r.rect(qx, qy, 8, 8, tone);
        r.hline(qx, qx + 7, qy + 7, c[2]);
        r.vline(qx + 7, qy, qy + 7, c[2]);
        r.px(qx, qy, c[0]);
        const s = hash2(x * 2 + (q % 2), z * 2 + Math.floor(q / 2), 32);
        if (s % 3 === 0) r.px(qx + 2 + (s % 4), qy + 2 + ((s >>> 2) % 4), c[2]);
      }
      break;
    }
    case 'wall': {
      const top = PALETTE.wallTop;
      if (faceVisible) {
        r.rect(0, 0, TILE, WALL_CAP, top[1]);
        r.hline(0, 15, 0, top[0]);
        r.hline(0, 15, WALL_CAP - 1, top[3]);
        const f = PALETTE.wallFace;
        r.rect(0, WALL_CAP, TILE, 10, f[1]);
        r.hline(0, 15, WALL_CAP, f[3]);
        // carta da parati a righe tenui
        for (let i = 1; i < TILE; i += 4) r.vline(i, WALL_CAP + 1, 12, f[2]);
        r.hline(0, 15, WALL_CAP + 6, f[0]);
        const b = PALETTE.baseboard;
        r.rect(0, 13, TILE, 3, b[1]);
        r.hline(0, 15, 13, b[0]);
        r.hline(0, 15, 15, b[3]);
      } else {
        r.rect(0, 0, TILE, TILE, top[1]);
        const s = hash2(x, z, 41);
        r.px(s % 14 + 1, (s >>> 4) % 14 + 1, top[2]);
        r.px((s >>> 8) % 14 + 1, (s >>> 12) % 14 + 1, top[0]);
      }
      break;
    }
    case 'door': {
      // soglia in legno scuro con stipiti
      const w = PALETTE.walnut;
      for (let i = 0; i < TILE; i += 4) {
        r.rect(i, 0, 4, TILE, hash2(x * 4 + i, z, 51) % 2 ? w[1] : w[0]);
        r.vline(i + 3, 0, 15, w[2]);
      }
      r.rect(0, 0, 2, TILE, w[3]);
      r.rect(14, 0, 2, TILE, w[3]);
      r.vline(1, 0, 15, w[2]);
      r.vline(14, 0, 15, w[2]);
      break;
    }
  }
  return r.image(0, 0);
}

// ---------------------------------------------------------------------------------------------------------------
// extra

/** fumetto rosso con "!" della sessione bloccata, ancorato alla punta in basso */
export function bubbleImage(): PixelImage {
  const r = new Raster(13, 15);
  const c = PALETTE.bubble;
  r.rect(2, 1, 9, 10, c[1]);
  r.rect(1, 2, 11, 8, c[1]);
  r.hline(2, 10, 1, c[0]);
  r.vline(1, 2, 8, c[0]);
  r.hline(2, 10, 10, c[2]);
  r.vline(11, 3, 9, c[2]);
  r.rect(5, 11, 3, 1, c[1]);
  r.px(6, 12, c[2]);
  // punto esclamativo
  r.rect(6, 3, 1, 4, '#ffffff');
  r.px(7, 3, '#ffffff');
  r.px(7, 4, PALETTE.bubble[0]);
  r.rect(6, 8, 1, 1, '#ffffff');
  r.outline(PALETTE.outline);
  return r.image(6, 14);
}

/** ombra ellittica semitrasparente sotto i personaggi, ancorata al centro */
export function shadowImage(): PixelImage {
  const r = new Raster(12, 5);
  r.ellipse(6, 2.5, 6, 2.5, PALETTE.shadow);
  return r.image(6, 2);
}

/** anello di selezione attorno ai piedi, ancorato al centro */
export function selectionImage(): PixelImage {
  const r = new Raster(20, 9);
  const c = PALETTE.select;
  r.ellipse(10, 4.5, 9.5, 4.5, c[1]);
  r.ellipse(10, 5, 8.5, 3.5, c[2]);
  // svuota l'interno: un colore con alfa 0 scrive pixel trasparenti
  r.ellipse(10, 4.5, 7.5, 2.8, '#00000000');
  r.hline(6, 13, 0, c[0]);
  return r.image(10, 4);
}

// ---------------------------------------------------------------------------------------------------------------
// canvas

export type SpriteCanvas = HTMLCanvasElement | OffscreenCanvas;

/** Copia i pixel in una canvas (OffscreenCanvas se disponibile), da disegnare con drawImage a scala intera. */
export function toCanvas(img: PixelImage): SpriteCanvas {
  const canvas: SpriteCanvas =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(img.w, img.h) : Object.assign(document.createElement('canvas'), { width: img.w, height: img.h });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (ctx) {
    const id = ctx.createImageData(img.w, img.h);
    id.data.set(img.data);
    ctx.putImageData(id, 0, 0);
  }
  return canvas;
}

export interface Sprite {
  canvas: SpriteCanvas;
  w: number;
  h: number;
  ax: number;
  ay: number;
}

const spriteCache = new Map<string, Sprite>();

/** canvas pronta per `key`, creata una volta sola da `make` */
export function cachedImage(key: string, make: () => PixelImage): Sprite {
  let s = spriteCache.get(key);
  if (!s) {
    const img = make();
    s = { canvas: toCanvas(img), w: img.w, h: img.h, ax: img.ax, ay: img.ay };
    spriteCache.set(key, s);
  }
  return s;
}

export function characterSprite(look: PixelLook, pose: Pose, facing: Facing, frame: number): Sprite {
  const f = frame % POSE_FRAMES[pose];
  return cachedImage(`c:${look.id}:${pose}:${facing}:${f}`, () => characterImage(look, pose, facing, f));
}

export function furnitureSprite(kind: FurnitureKind, facing: Facing, w: number, h: number, frame = 0): Sprite {
  const n = FURNITURE_FRAMES[kind];
  const f = n && frame >= 0 ? frame % n : frame < 0 ? -1 : 0;
  return cachedImage(`f:${kind}:${facing}:${w}x${h}:${f}`, () => furnitureImage(kind, facing, w, h, f));
}

export function tileSprite(kind: TileKind, x: number, z: number, faceVisible: boolean): Sprite {
  return cachedImage(`t:${kind}:${x}:${z}:${faceVisible ? 1 : 0}`, () => tileImage(kind, x, z, faceVisible));
}
