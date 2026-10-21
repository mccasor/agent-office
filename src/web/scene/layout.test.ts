import { describe, expect, it } from 'vitest';
import { BOARD_COLUMNS, createLayout, deskCells, plantCells, cellKey, loungePlan } from './layout';
import { findPath } from './path';

const sizes = [0, 1, 4, 8, 9, 13, 24, 40];

describe('createLayout', () => {
  it('ha almeno 8 posti anche con pochi agenti e almeno minSeats posti', () => {
    for (const n of sizes) {
      const l = createLayout(n);
      expect(l.seats.length).toBeGreaterThanOrEqual(Math.max(8, n));
      expect(l.seats.length % 4).toBe(0);
    }
  });

  it('è deterministico', () => {
    expect(createLayout(13)).toEqual(createLayout(13));
  });

  it('griglia walkable[z][x] coerente con width/depth', () => {
    const l = createLayout(9);
    expect(l.walkable.length).toBe(l.depth);
    for (const row of l.walkable) expect(row.length).toBe(l.width);
  });

  it('porta al centro della parete sud, walkable; perimetro altrimenti non walkable', () => {
    for (const n of sizes) {
      const l = createLayout(n);
      expect(l.door).toEqual({ x: Math.floor(l.width / 2), z: l.depth - 1 });
      expect(l.walkable[l.door.z]![l.door.x]).toBe(true);
      // la cella appena dentro la porta è un corridoio
      expect(l.walkable[l.door.z - 1]![l.door.x]).toBe(true);
      for (let x = 0; x < l.width; x++) {
        expect(l.walkable[0]![x]).toBe(false);
        if (x !== l.door.x) expect(l.walkable[l.depth - 1]![x]).toBe(false);
      }
      for (let z = 0; z < l.depth; z++) {
        expect(l.walkable[z]![0]).toBe(false);
        expect(l.walkable[z]![l.width - 1]).toBe(false);
      }
    }
  });

  it('seat walkable, scrivanie non walkable, nessuna sovrapposizione seat/scrivania/pianta', () => {
    for (const n of sizes) {
      const l = createLayout(n);
      const desks = deskCells(l);
      const plants = plantCells(l);
      expect(desks.length).toBe(l.seats.length);
      const deskKeys = new Set(desks.map((d) => cellKey(d.cell)));
      const plantKeys = new Set(plants.map(cellKey));
      const seatKeys = new Set(l.seats.map((s) => cellKey(s.cell)));
      expect(seatKeys.size).toBe(l.seats.length);
      expect(deskKeys.size).toBe(desks.length);
      expect(new Set(l.seats.map((s) => s.id)).size).toBe(l.seats.length);
      for (const s of l.seats) {
        expect(l.walkable[s.cell.z]![s.cell.x]).toBe(true);
        expect(deskKeys.has(cellKey(s.cell))).toBe(false);
        expect(plantKeys.has(cellKey(s.cell))).toBe(false);
      }
      for (const d of desks) {
        expect(l.walkable[d.cell.z]![d.cell.x]).toBe(false);
        expect(plantKeys.has(cellKey(d.cell))).toBe(false);
      }
      for (const p of plants) expect(l.walkable[p.z]![p.x]).toBe(false);
    }
  });

  it('ogni seat guarda la propria scrivania (cella adiacente non walkable)', () => {
    const l = createLayout(16);
    for (const s of l.seats) {
      const dx = Math.round(Math.sin(s.facing));
      const dz = Math.round(Math.cos(s.facing));
      expect(Math.abs(dx) + Math.abs(dz)).toBe(1);
      expect(l.walkable[s.cell.z + dz]![s.cell.x + dx]).toBe(false);
    }
  });

  it('ogni seat è raggiungibile dalla porta', () => {
    for (const n of sizes) {
      const l = createLayout(n);
      for (const s of l.seats) {
        const p = findPath(l, l.door, s.cell);
        expect(p.length).toBeGreaterThan(0);
      }
    }
  });

  it('cresce aggiungendo isole', () => {
    const a = createLayout(8);
    const b = createLayout(30);
    expect(b.width * b.depth).toBeGreaterThan(a.width * a.depth);
    expect(b.seats.length).toBeGreaterThan(a.seats.length);
  });
});

describe('stanza del boss e area relax', () => {
  it('posto del boss e divani raggiungibili dalla porta, liberi da scrivanie e piante', () => {
    for (const n of sizes) {
      const l = createLayout(n);
      for (const s of [l.bossSeat, ...l.lounge]) {
        expect(l.walkable[s.cell.z]![s.cell.x]).toBe(true);
        expect(findPath(l, l.door, s.cell).length).toBeGreaterThan(0);
      }
    }
  });

  it('il boss si raggiunge solo dalla porta della vetrata', () => {
    const l = createLayout(8);
    const path = findPath(l, l.door, l.bossSeat.cell);
    expect(path.some((c) => c.x === l.bossDoor.x && c.z === l.bossDoor.z)).toBe(true);
    for (let z = 1; z < l.depth - 1; z++) expect(l.walkable[z]![l.bossDoor.x]).toBe(z === l.bossDoor.z);
  });

  it('poltroncine e divanetti rivolti al tavolino del salottino, posti distinti', () => {
    for (const n of sizes) {
      const l = createLayout(n);
      const plan = loungePlan(l);
      expect(plan.nooks.length).toBeGreaterThanOrEqual(2);
      expect(l.lounge.length).toBe(plan.nooks.length * 4);
      expect(new Set(l.lounge.map((s) => cellKey(s.cell))).size).toBe(l.lounge.length);
      for (const s of l.lounge) {
        expect(s.cell.x + Math.round(Math.sin(s.facing))).toBe(plan.tableX);
        expect(l.walkable[s.cell.z]![plan.tableX]).toBe(false);
      }
    }
  });

  it("il separè chiude l'area relax tranne a sud, verso l'ingresso", () => {
    const l = createLayout(8);
    const { screenX, screenZ1 } = loungePlan(l);
    for (let z = 1; z < l.depth - 1; z++) expect(l.walkable[z]![screenX]).toBe(z > screenZ1);
  });
});

describe('board dei task', () => {
  it('tre board sulla parete nord, nel corridoio, raggiungibili, in ordine to do → in review', () => {
    for (const n of sizes) {
      const l = createLayout(n);
      const xs = BOARD_COLUMNS.map((c) => l.boards[c].cell.x);
      expect(xs).toEqual([...xs].sort((a, b) => a - b));
      for (const c of BOARD_COLUMNS) {
        const b = l.boards[c];
        expect(b.cell.z).toBe(1);
        expect(b.facing).toBe(Math.PI);
        expect(findPath(l, l.door, b.cell).length).toBeGreaterThan(0);
        for (const s of l.seats) expect(findPath(l, b.cell, s.cell).length).toBeGreaterThan(0);
      }
    }
  });
});
