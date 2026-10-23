import type { Viewport } from './draw';
import { PALETTE } from './sprites';
import { TILE, type Cell, type PixelPlan } from './types';

/**
 * Luci delle stanze nella vista 2D (#99): una stanza con qualcuno al lavoro è illuminata, senza nessuno (o con la
 * sola istanza inattiva, pallino grigio) è in penombra. Puro tranne `RoomLights.draw`; la geometria si calcola una
 * volta, a ogni fotogramma restano un paio di confronti per zona e qualche fillRect.
 */

/** tinta della penombra: blu notte della palette, semitrasparente (arredi e pavimento restano leggibili) */
export const DUSK = PALETTE.night[3];
/** opacità della penombra a luci spente */
export const DUSK_ALPHA = 0.55;
/** chiarore dalle finestre a luci spente: vetro e lama di luce sul pavimento, che sfuma riga per riga */
export const MOONLIGHT = PALETTE.sky[1];
const GLOW = { window: 0.3, floor: [0.08, 0.05, 0.025] } as const;

/** secondi per spegnersi del tutto */
export const FADE_OFF = 0.45;
/**
 * Accensione da neon: [istante (s), frazione del buio di partenza]; a gradini, finisce accesa a FLICKER_END.
 * Un lampo, si rispegne, un lampo più lungo, mezza luce, accesa.
 */
const FLICKER: readonly (readonly [number, number])[] = [[0, 0], [0.05, 0.8], [0.1, 0], [0.16, 0.45], [0.22, 0]];
export const FLICKER_END = 0.22;

export const CORRIDOR = 'corridor';

export interface LightZone {
  /** id della stanza ('room-0'..'room-4', 'lounge') o CORRIDOR */
  id: string;
  kind: 'instance' | 'lounge' | 'corridor';
}

interface Rect {
  x: number;
  z: number;
  w: number;
  h: number;
}

/** pezzo di overlay: segue una zona, o (pareti di confine) la più illuminata tra le zone vicine */
interface Patch extends Rect {
  zones: number[];
}

export interface LightGeometry {
  zones: LightZone[];
  /** owner[z][x]: indice della zona della cella, -1 se nessuna (pareti di confine, vuoto) */
  owner: number[][];
  patches: Patch[];
  /** finestre delle stanze, con la zona */
  windows: (Rect & { zone: number })[];
}

/**
 * Zone di luce: ogni stanza (interno più la parete nord con la porta, se c'è) e il corridoio (con la parete delle
 * stanze sopra, le loro porte e l'ingresso). Le pareti di confine seguono la stanza vicina più illuminata (il corridoio solo se non tocca stanze).
 */
export function lightGeometry(plan: PixelPlan): LightGeometry {
  const zones: LightZone[] = [];
  const owner = plan.tiles.map((row) => row.map(() => -1));
  const claim = (r: Rect, i: number) => {
    for (let z = Math.max(0, r.z); z < Math.min(plan.depth, r.z + r.h); z++) {
      for (let x = Math.max(0, r.x); x < Math.min(plan.width, r.x + r.w); x++) {
        if (owner[z]![x] === -1 && plan.tiles[z]![x] !== 'void') owner[z]![x] = i;
      }
    }
  };
  for (const r of plan.rooms) {
    claim({ x: r.x, z: r.z - 1, w: r.w, h: r.h + 1 }, zones.length);
    zones.push({ id: r.id, kind: r.kind });
  }
  let top = Infinity;
  let bottom = -1;
  plan.tiles.forEach((row, z) => {
    if (row.includes('corridor')) {
      top = Math.min(top, z);
      bottom = z;
    }
  });
  if (bottom >= 0) {
    claim({ x: 0, z: top - 1, w: plan.width, h: bottom - top + 2 }, zones.length);
    zones.push({ id: CORRIDOR, kind: 'corridor' });
  }

  // chiave per cella: la sua zona, o le zone confinanti (8 vicini) per le pareti senza zona
  const keyOf = (x: number, z: number): number[] | null => {
    const o = owner[z]![x]!;
    if (o >= 0) return [o];
    if (plan.tiles[z]![x] === 'void') return null;
    const near = new Set<number>();
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const n = owner[z + dz]?.[x + dx];
      if (n !== undefined && n >= 0) near.add(n);
    }
    // le pareti di una stanza seguono le stanze, non il corridoio che tocca solo un angolo
    const rooms = [...near].filter((n) => zones[n]!.kind !== 'corridor');
    const key = rooms.length > 0 ? rooms : [...near];
    return key.length > 0 ? key.sort((a, b) => a - b) : null;
  };
  // tratti orizzontali con la stessa chiave, poi uniti in verticale quando combaciano
  const patches: Patch[] = [];
  let open: Patch[] = [];
  for (let z = 0; z < plan.depth; z++) {
    const runs: Patch[] = [];
    for (let x = 0; x < plan.width; x++) {
      const zones = keyOf(x, z);
      if (!zones) continue;
      const last = runs[runs.length - 1];
      if (last && last.x + last.w === x && same(last.zones, zones)) last.w++;
      else runs.push({ x, z, w: 1, h: 1, zones });
    }
    const next: Patch[] = [];
    for (const run of runs) {
      const above = open.find((p) => p.x === run.x && p.w === run.w && same(p.zones, run.zones));
      if (above) {
        above.h++;
        next.push(above);
      } else {
        patches.push(run);
        next.push(run);
      }
    }
    open = next;
  }

  const windows = plan.furniture
    .filter((f) => f.kind === 'window')
    .map((f) => ({ x: f.cell.x, z: f.cell.z, w: f.w, h: f.h, zone: owner[f.cell.z]?.[f.cell.x] ?? -1 }))
    .filter((w) => w.zone >= 0);
  return { zones, owner, patches, windows };
}

const same = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/** zona della cella (anche frazionaria, arrotondata), -1 fuori */
export function zoneAt(g: LightGeometry, pos: Cell): number {
  return g.owner[Math.round(pos.z)]?.[Math.round(pos.x)] ?? -1;
}

/** un personaggio visibile: dove sta adesso e di quale sessione è */
export interface Occupant {
  sessionId: string;
  pos: Cell;
}

/**
 * Zone accese. Stanza istanza: dentro c'è qualcuno e la sua sessione non è inattiva (pallino grigio); una stanza
 * senza sessione (chi esce dopo la fine) segue chi c'è dentro. Sala relax: dentro c'è qualcuno di una sessione non
 * inattiva. Corridoio: c'è qualcuno di una sessione non inattiva in tutto l'ufficio.
 */
export function litZones(
  g: LightGeometry, occupants: Iterable<Occupant>, rooms: Readonly<Record<string, number>>, idle: ReadonlySet<string>,
): Set<string> {
  const ownerOf = new Map<string, string>();
  for (const [sessionId, room] of Object.entries(rooms)) ownerOf.set(`room-${room}`, sessionId);
  const lit = new Set<string>();
  for (const o of occupants) {
    if (!idle.has(o.sessionId)) lit.add(CORRIDOR);
    const zone = g.zones[zoneAt(g, o.pos)];
    if (!zone || zone.kind === 'corridor') continue;
    const session = zone.kind === 'instance' ? (ownerOf.get(zone.id) ?? o.sessionId) : o.sessionId;
    if (!idle.has(session)) lit.add(zone.id);
  }
  return lit;
}

/** interruttore di una zona: acceso o spento dall'istante `at` (s), partendo dal buio `from` (0 acceso, 1 spento) */
export interface Switch {
  on: boolean;
  at: number;
  from: number;
}

/** buio della zona all'istante `now` (0 accesa, 1 spenta): sfuma allo spegnimento, sfarfalla all'accensione */
export function darknessAt(sw: Switch, now: number): number {
  const t = now - sw.at;
  if (!sw.on) return t >= FADE_OFF ? 1 : sw.from + (1 - sw.from) * Math.max(0, t / FADE_OFF);
  if (t >= FLICKER_END) return 0;
  let k = FLICKER[0]![1];
  for (const [at, v] of FLICKER) if (t >= at) k = v;
  return sw.from * (t < 0 ? 1 : k);
}

/** Stato delle luci tra un fotogramma e l'altro; la prima volta le accende o spegne senza transizione. */
export class RoomLights {
  readonly geometry: LightGeometry;
  private switches: Switch[] | null = null;
  private dark: number[];

  constructor(plan: PixelPlan) {
    this.geometry = lightGeometry(plan);
    this.dark = this.geometry.zones.map(() => 0);
  }

  /** aggiorna gli interruttori con le zone accese adesso e calcola il buio di ogni zona */
  update(lit: ReadonlySet<string>, now: number): void {
    const { zones } = this.geometry;
    if (!this.switches) this.switches = zones.map((z) => ({ on: lit.has(z.id), at: -Infinity, from: 1 }));
    zones.forEach((z, i) => {
      const sw = this.switches![i]!;
      const on = lit.has(z.id);
      if (sw.on !== on) this.switches![i] = { on, at: now, from: darknessAt(sw, now) };
      this.dark[i] = darknessAt(this.switches![i]!, now);
    });
  }

  /** qualche zona sta ancora sfumando o sfarfallando all'istante `now`: il loop di disegno non può dormire */
  busy(now: number): boolean {
    return this.switches?.some((sw) => now - sw.at < (sw.on ? FLICKER_END : FADE_OFF)) ?? false;
  }

  /** buio di ogni zona in questo fotogramma (per capire se il fotogramma è cambiato) */
  get levels(): readonly number[] {
    return this.dark;
  }

  /** la zona ha l'interruttore acceso */
  isOn(zone: number): boolean {
    return this.switches?.[zone]?.on ?? true;
  }

  /** schermi (cellKey del monitor -> area): spegne quelli nelle zone spente */
  dimScreens(screens: Map<string, string>): void {
    for (const key of screens.keys()) {
      const [x, z] = key.split(',').map(Number);
      const zone = zoneAt(this.geometry, { x: x!, z: z! });
      if (zone >= 0 && !this.isOn(zone)) screens.delete(key);
    }
  }

  /** buio di un pezzo: quello della sua zona, per le pareti di confine il meno buio tra le zone vicine */
  private patchDark(p: Patch): number {
    let d = 1;
    for (const z of p.zones) d = Math.min(d, this.dark[z]!);
    return d;
  }

  /** penombra sopra pavimenti, arredi e personaggi (sotto alle etichette), più il chiarore dalle finestre */
  draw(ctx: CanvasRenderingContext2D, view: Viewport): void {
    const k = view.scale * TILE;
    const fill = (x: number, z: number, w: number, h: number) => ctx.fillRect(view.ox + x * k, view.oy + z * k, w * k, h * k);
    const alpha = ctx.globalAlpha;
    ctx.fillStyle = DUSK;
    for (const p of this.geometry.patches) {
      const d = this.patchDark(p);
      if (d <= 0.01) continue;
      ctx.globalAlpha = alpha * DUSK_ALPHA * d;
      fill(p.x, p.z, p.w, p.h);
    }
    ctx.fillStyle = MOONLIGHT;
    for (const w of this.geometry.windows) {
      const d = this.dark[w.zone]!;
      if (d <= 0.01) continue;
      ctx.globalAlpha = alpha * GLOW.window * d;
      fill(w.x, w.z, w.w, w.h);
      // lama di luce: si allarga di mezza cella per lato a ogni riga
      GLOW.floor.forEach((a, i) => {
        ctx.globalAlpha = alpha * a * d;
        fill(w.x - (i + 1) / 2, w.z + w.h + i, w.w + i + 1, 1);
      });
    }
    ctx.globalAlpha = alpha;
  }
}
