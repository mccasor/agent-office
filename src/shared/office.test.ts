import { describe, expect, it } from 'vitest';
import { parseConfig } from '../server/config.js';
import { DEFAULT_OFFICE_ROOMS, officeBusy, parseOfficeRooms, resolveOffice, type OfficeRoom } from './office.js';
import { toDisplaySettings } from './settings.js';

const room = (type: string, variant?: unknown) => (variant === undefined ? { type } : { type, variant });
const many = (n: number, type: string) => Array.from({ length: n }, () => room(type, null));

describe('composizione dell\'ufficio (#108)', () => {
  it('default: 5 stanze da 8 postazioni a rotazione e la sala relax', () => {
    expect(DEFAULT_OFFICE_ROOMS).toEqual([...many(5, 'work8'), room('relax', null)]);
    expect(resolveOffice(undefined).rooms).toEqual(DEFAULT_OFFICE_ROOMS);
  });

  it('valide: tipi noti, stile nei limiti o automatico, da 1 a 7 di lavoro e da 1 a 3 hobby, 8 in tutto', () => {
    const ok: unknown[][] = [
      [room('work8'), room('relax')],
      [...many(7, 'work12'), room('pingpong', 1)],
      [...many(5, 'work4'), room('relax'), room('console'), room('pingpong')],
      [room('work4', 8), room('work8', 4), room('work12', 4), room('console', null)],
    ];
    for (const rooms of ok) expect(parseOfficeRooms(rooms), JSON.stringify(rooms)).toBeDefined();
    // `variant` assente vale null; chiavi in più ignorate
    expect(parseOfficeRooms([{ type: 'work4', extra: 1 }, room('relax', null)])).toEqual([{ type: 'work4', variant: null }, { type: 'relax', variant: null }]);
  });

  it('non valide: tutto l\'elenco vale il default', () => {
    const bad: unknown[] = [
      undefined, null, 'tante', {}, [],
      [room('work8')], [room('relax')],
      [...many(8, 'work8'), room('relax')],
      [...many(6, 'work8'), ...many(3, 'relax')],
      [room('work8'), ...many(4, 'relax')],
      [room('work8', 5), room('relax')], [room('work4', 0), room('relax')], [room('work4', 1.5), room('relax')],
      [room('work4', '1'), room('relax')], [room('relax', 2), room('work8')], [room('work16'), room('relax')],
      [1, room('relax')], [[room('work8')], room('relax')],
    ];
    for (const rooms of bad) {
      expect(parseOfficeRooms(rooms), JSON.stringify(rooms)).toBeUndefined();
      expect(resolveOffice({ rooms }).rooms).toEqual(DEFAULT_OFFICE_ROOMS);
    }
    expect(resolveOffice([room('work8'), room('relax')]).rooms).toEqual(DEFAULT_OFFICE_ROOMS);
  });

  it('config.json: `office.rooms` letto dal server e inviato alle pagine', () => {
    const rooms: OfficeRoom[] = [{ type: 'work12', variant: 2 }, { type: 'console', variant: null }];
    expect(parseConfig({ office: { rooms } }).office.rooms).toEqual(rooms);
    expect(parseConfig({ office: { rooms: [] } }).office.rooms).toEqual(DEFAULT_OFFICE_ROOMS);
    expect(toDisplaySettings({ office: { rooms } }).office.rooms).toEqual(rooms);
    // server vecchio, senza composizione: il default
    expect(toDisplaySettings({ language: 'it' }).office.rooms).toEqual(DEFAULT_OFFICE_ROOMS);
  });

  it('bloccata solo da sessioni attive al lavoro o in attesa; le ferme (grigie) no', () => {
    expect(officeBusy([])).toBe(false);
    expect(officeBusy([{ active: true, dot: 'idle' }, { active: false, dot: 'working' }])).toBe(false);
    expect(officeBusy([{ active: true, dot: 'idle' }, { active: true, dot: 'working' }])).toBe(true);
    expect(officeBusy([{ active: true, dot: 'waiting' }])).toBe(true);
  });
});
