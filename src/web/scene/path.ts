import type { Cell, OfficeLayout } from './layout';

const DIRS: readonly Cell[] = [
  { x: 0, z: -1 },
  { x: 1, z: 0 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
];

export function isWalkable(layout: OfficeLayout, c: Cell): boolean {
  return Number.isInteger(c.x) && Number.isInteger(c.z) && layout.walkable[c.z]?.[c.x] === true;
}

/** A* su griglia 4-direzioni (euristica manhattan); [] se irraggiungibile. Include from e to. */
export function findPath(layout: OfficeLayout, from: Cell, to: Cell): Cell[] {
  if (!isWalkable(layout, from) || !isWalkable(layout, to)) return [];
  const w = layout.width;
  const idx = (c: Cell) => c.z * w + c.x;
  const h = (c: Cell) => Math.abs(c.x - to.x) + Math.abs(c.z - to.z);
  const start = idx(from);
  const goal = idx(to);
  const g = new Map<number, number>([[start, 0]]);
  const parent = new Map<number, number>();
  const closed = new Set<number>();
  // open set piccolo (griglie da poche centinaia di celle): scansione lineare, tie-break deterministico.
  const open: { i: number; f: number; h: number }[] = [{ i: start, f: h(from), h: h(from) }];
  while (open.length > 0) {
    let best = 0;
    for (let k = 1; k < open.length; k++) {
      const a = open[k]!;
      const b = open[best]!;
      if (a.f < b.f || (a.f === b.f && a.h < b.h)) best = k;
    }
    const cur = open.splice(best, 1)[0]!.i;
    if (cur === goal) break;
    if (closed.has(cur)) continue;
    closed.add(cur);
    const cx = cur % w;
    const cz = (cur - cx) / w;
    for (const d of DIRS) {
      const n = { x: cx + d.x, z: cz + d.z };
      if (!isWalkable(layout, n)) continue;
      const ni = idx(n);
      const ng = g.get(cur)! + 1;
      if (closed.has(ni) || ng >= (g.get(ni) ?? Infinity)) continue;
      g.set(ni, ng);
      parent.set(ni, cur);
      open.push({ i: ni, f: ng + h(n), h: h(n) });
    }
  }
  if (!g.has(goal)) return [];
  const out: Cell[] = [];
  for (let i: number | undefined = goal; i !== undefined; i = parent.get(i)) {
    out.push({ x: i % w, z: Math.floor(i / w) });
  }
  return out.reverse();
}

/**
 * Path da una posizione anche frazionaria (a metà di un segmento tra due celle) a `to`: parte dalla più
 * conveniente delle due celle vicine, così chi cambia meta a metà strada non fa un passo indietro. [] se irraggiungibile.
 */
export function planFrom(layout: OfficeLayout, pos: Cell, to: Cell): Cell[] {
  const lo = { x: Math.floor(pos.x), z: Math.floor(pos.z) };
  const hi = { x: Math.ceil(pos.x), z: Math.ceil(pos.z) };
  let best: Cell[] = [];
  let bestLen = Infinity;
  for (const start of lo.x === hi.x && lo.z === hi.z ? [lo] : [lo, hi]) {
    const path = findPath(layout, start, to);
    if (path.length === 0) continue;
    const offset = Math.hypot(pos.x - start.x, pos.z - start.z);
    if (offset + path.length - 1 < bestLen) {
      bestLen = offset + path.length - 1;
      best = offset > 0 ? [pos, ...path] : path;
    }
  }
  return best;
}
