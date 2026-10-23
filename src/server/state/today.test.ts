import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionState, Snapshot } from '../../shared/types.js';
import { createDayTracker, midnightOf, SAVE_MS } from './today.js';

// istanti in ora locale, lontani dalla mezzanotte: i test non dipendono dal fuso orario
const DAY = new Date(2026, 0, 10).getTime();
const H = 3_600_000;
const START = DAY + 9 * H;
const zero = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 };

const session = (id: string, over: Partial<SessionState> = {}): SessionState => ({
  id, title: null, model: null, effort: null, context: { used: 0, window: null }, tokensUsed: zero, startedAt: START, updatedAt: START,
  active: true, status: 'working', issues: [], cwd: null, branch: null, waiting: false, dot: 'working', project: null, ...over,
});
const snap = (sessions: SessionState[]): Snapshot => ({ status: 'idle', sessions, agents: [], finished: [], generatedAt: 0 });
/** conteggi dallo storico (provati in history): qui passano tali e quali, l'attesa a minuti interi */
const counts = { launched: 3, finished: 2, failed: 1, waitingMs: 18 * 60_000 + 30_000 };
const M = 60_000;

describe('createDayTracker', () => {
  it('mezzanotte locale', () => {
    expect(midnightOf(START)).toBe(DAY);
  });

  it('costo di oggi: le sessioni nate oggi per intero, le altre dagli aumenti; ultima ora solo gli aumenti recenti', () => {
    const t = createDayTracker(START);
    // nata ieri: conta solo da adesso; nata oggi prima dell'avvio: per intero ma non nell'ultima ora
    let today = t.observe(snap([session('ieri', { startedAt: DAY - H, cost: 10 }), session('oggi', { startedAt: DAY + H, cost: 2 })]), START, counts);
    expect(today).toMatchObject({ since: START, cost: 2, costLastHour: 0 });
    today = t.observe(snap([session('ieri', { startedAt: DAY - H, cost: 10.5 }), session('oggi', { startedAt: DAY + H, cost: 3 })]), START + 30 * M, counts);
    expect(today).toMatchObject({ cost: 3.5, costLastHour: 1.5 });
    // un'ora dopo l'aumento esce dalla finestra; una sessione nata dopo l'avvio entra subito
    today = t.observe(snap([session('nuova', { startedAt: START + H, cost: 0.25 })]), START + 2 * H, counts);
    expect(today).toMatchObject({ cost: 3.75, costLastHour: 0.25 });
  });

  it('nessun modello nel listino: costo null', () => {
    expect(createDayTracker(START).observe(snap([session('s1')]), START, counts)).toMatchObject({ cost: null, costLastHour: null });
  });

  it('conteggi dallo storico, l\'attesa a minuti interi', () => {
    expect(createDayTracker(START).observe(snap([]), START, counts)).toMatchObject({ launched: 3, finished: 2, failed: 1, waitingMs: 18 * M });
  });

  it('a mezzanotte si riparte da zero', () => {
    const t = createDayTracker(START);
    t.observe(snap([session('s1', { startedAt: START, cost: 1 })]), START, counts);
    const next = t.observe(snap([session('s1', { startedAt: START, cost: 1.5 })]), DAY + 25 * H, counts);
    expect(next).toMatchObject({ since: DAY + 24 * H, cost: 0.5 });
  });

  describe('riavvio (#102)', () => {
    let dir: string;
    let file: string;
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'agent-office-today-'));
      file = join(dir, 'today.json');
    });
    afterEach(() => rm(dir, { recursive: true, force: true }));

    const open = async (at: number) => {
      const t = createDayTracker(at, { file });
      await t.start();
      return t;
    };
    const ieri = (cost: number) => session('ieri', { startedAt: DAY - H, cost });
    const oggi = (cost: number) => session('oggi', { startedAt: DAY + H, cost });

    it('stessi valori dopo il riavvio, senza contare due volte il costo delle sessioni già viste', async () => {
      let t = await open(START);
      t.observe(snap([ieri(10), oggi(2)]), START, counts);
      const before = t.observe(snap([ieri(10.5), oggi(3)]), START + 30 * M, counts);
      expect(before).toMatchObject({ cost: 3.5, costLastHour: 1.5 });
      await t.flush();

      // stessi costi alla prima lettura: niente da aggiungere, e l'ultima ora resta quella di prima
      t = await open(START + 40 * M);
      expect(t.observe(snap([ieri(10.5), oggi(3)]), START + 40 * M, counts)).toEqual({ ...before, since: START, waitingMs: 18 * M });
      // un aumento visto dopo il riavvio conta normalmente
      expect(t.observe(snap([ieri(10.75), oggi(3)]), START + 45 * M, counts)).toMatchObject({ cost: 3.75, costLastHour: 1.75 });
    });

    it('$/h: un aumento avvenuto a server spento va nel costo di oggi ma non nell\'ultima ora', async () => {
      let t = await open(START);
      t.observe(snap([ieri(10), oggi(2)]), START, counts);
      await t.flush();
      t = await open(START + 2 * H);
      // 4 dollari spesi mentre l'app era chiusa: nessun picco falso
      expect(t.observe(snap([ieri(12), oggi(4)]), START + 2 * H, counts)).toMatchObject({ cost: 6, costLastHour: 0 });
      // una sessione nata oggi dopo l'ultimo salvataggio ma prima del riavvio: per intero, non nell'ultima ora
      expect(t.observe(snap([ieri(12), oggi(4), session('dopo', { startedAt: START + H, cost: 1 })]), START + 2 * H + M, counts))
        .toMatchObject({ cost: 7, costLastHour: 0 });
    });

    it('salva solo se qualcosa cambia e al più ogni SAVE_MS; un arresto brusco non perde il costo', async () => {
      let t = await open(START);
      t.observe(snap([oggi(1)]), START, counts);
      t.observe(snap([oggi(1)]), START + SAVE_MS, counts);
      await t.flush();
      const saved = await readFile(file, 'utf8');
      expect(JSON.parse(saved)).toMatchObject({ day: '2026-01-10', cost: 1, sessions: { oggi: { cost: 1 } } });
      // nulla di nuovo: nessuna scrittura
      await writeFile(file, saved.replace('"cost":1,', '"cost":1,"segno":1,'));
      t.observe(snap([oggi(1)]), START + 3 * SAVE_MS, counts);
      await t.flush();
      expect(await readFile(file, 'utf8')).toContain('segno');
      // aumento non ancora salvato (meno di SAVE_MS), poi arresto brusco: al riavvio si recupera dal costo della sessione
      t.observe(snap([oggi(1.5)]), START + 3 * SAVE_MS + 1000, counts);
      t = await open(START + 4 * SAVE_MS);
      expect(t.observe(snap([oggi(1.5)]), START + 4 * SAVE_MS, counts)).toMatchObject({ cost: 1.5 });
    });

    it('file di ieri, illeggibile o senza la cartella: si riparte da zero senza errori', async () => {
      await writeFile(file, JSON.stringify({ day: '2026-01-09', since: DAY - H, cost: 50, priced: true, sessions: { oggi: { cost: 0, seen: DAY - H } }, samples: [] }));
      let t = await open(START);
      expect(t.observe(snap([oggi(2)]), START, counts)).toMatchObject({ since: START, cost: 2 });
      await writeFile(file, '{"day":"2026-01-10","cost":');
      t = await open(START);
      expect(t.observe(snap([oggi(2)]), START, counts)).toMatchObject({ cost: 2 });
      t = createDayTracker(START, { file: join(dir, 'manca', 'today.json') });
      await t.start();
      t.observe(snap([oggi(2)]), START + SAVE_MS, counts);
      await t.flush();
    });

    it('mezzanotte dopo un riavvio: il costo riparte da zero, la base delle sessioni resta', async () => {
      let t = await open(DAY + 23 * H);
      t.observe(snap([oggi(2)]), DAY + 23 * H, counts);
      await t.flush();
      t = await open(DAY + 23 * H + 30 * M);
      t.observe(snap([oggi(2)]), DAY + 23 * H + 30 * M, counts);
      const next = t.observe(snap([oggi(2.5)]), DAY + 24 * H + 10 * M, counts);
      expect(next).toMatchObject({ since: DAY + 24 * H, cost: 0.5, costLastHour: 0.5 });
      await t.flush();
      expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ day: '2026-01-11', cost: 0.5 });
      // riavvio il giorno dopo: riprende il file nuovo
      t = await open(DAY + 25 * H);
      expect(t.observe(snap([oggi(2.5)]), DAY + 25 * H, counts)).toMatchObject({ since: DAY + 24 * H, cost: 0.5 });
    });
  });
});
