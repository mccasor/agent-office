/**
 * Composizione dell'ufficio (#108): l'elenco delle stanze, scelto nelle Impostazioni (sezione "Ufficio") e salvato
 * in config.json come `office: { rooms: [{ type, variant }] }`. Stesse regole in src-tauri/src/config.rs e nella
 * pagina src-tauri/splash/settings.html (che le riceve da settings-catalog.js): un elenco non valido vale il default.
 *
 * - stanze di lavoro (una per istanza di Claude): 4, 8 o 12 postazioni, ognuna con le sue piante (src/web/pixel/rooms.ts);
 * - sale hobby, dove aspetta chi ha finito: relax, console, ping-pong.
 * `variant` è lo stile, da 1 al numero di piante del tipo; null = automatico (a rotazione).
 */
import type { SessionState } from './types.js';

export const WORK_ROOM_TYPES = ['work4', 'work8', 'work12'] as const;
export const HOBBY_ROOM_TYPES = ['relax', 'console', 'pingpong'] as const;
export const ROOM_TYPES = [...WORK_ROOM_TYPES, ...HOBBY_ROOM_TYPES] as const;

export type WorkRoomType = (typeof WORK_ROOM_TYPES)[number];
export type HobbyKind = (typeof HOBBY_ROOM_TYPES)[number];
export type OfficeRoomType = WorkRoomType | HobbyKind;

export interface OfficeRoom {
  type: OfficeRoomType;
  /** stile da 1 a ROOM_VARIANTS[type]; null = automatico */
  variant: number | null;
}

/** piante disponibili per tipo (stili); le sale hobby hanno una pianta sola */
export const ROOM_VARIANTS: Record<OfficeRoomType, number> = { work4: 8, work8: 4, work12: 4, relax: 1, console: 1, pingpong: 1 };

/** limiti della composizione: al massimo 8 stanze, da 1 a 7 di lavoro e da 1 a 3 sale hobby */
export const OFFICE_LIMITS = { rooms: 8, work: [1, 7], hobby: [1, 3] } as const;

/** l'ufficio di sempre: 5 stanze da 8 postazioni (stili a rotazione) e la sala relax */
export const DEFAULT_OFFICE_ROOMS: readonly OfficeRoom[] = [
  ...Array.from({ length: 5 }, (): OfficeRoom => ({ type: 'work8', variant: null })),
  { type: 'relax', variant: null },
];

export const isHobby = (type: OfficeRoomType): type is HobbyKind => (HOBBY_ROOM_TYPES as readonly string[]).includes(type);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Una stanza valida, o undefined. `variant` assente vale null. */
function parseRoom(raw: unknown): OfficeRoom | undefined {
  if (!isObject(raw)) return undefined;
  const type = ROOM_TYPES.find((t) => t === raw.type);
  if (!type) return undefined;
  const v = raw.variant ?? null;
  if (v !== null && !(typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= ROOM_VARIANTS[type])) return undefined;
  return { type, variant: v };
}

/** Elenco di stanze di config.json (qualunque) → valido, oppure undefined se una stanza o i limiti non vanno. Pura. */
export function parseOfficeRooms(raw: unknown): OfficeRoom[] | undefined {
  if (!Array.isArray(raw) || raw.length > OFFICE_LIMITS.rooms) return undefined;
  const rooms = raw.map(parseRoom);
  if (rooms.some((r) => r === undefined)) return undefined;
  const valid = rooms as OfficeRoom[];
  const hobby = valid.filter((r) => isHobby(r.type)).length;
  const work = valid.length - hobby;
  const [minWork, maxWork] = OFFICE_LIMITS.work;
  const [minHobby, maxHobby] = OFFICE_LIMITS.hobby;
  return work >= minWork && work <= maxWork && hobby >= minHobby && hobby <= maxHobby ? valid : undefined;
}

/** `office` di config.json → composizione valida; non valida o assente vale il default. Pura. */
export function resolveOffice(raw: unknown): { rooms: OfficeRoom[] } {
  const rooms = isObject(raw) ? parseOfficeRooms(raw.rooms) : undefined;
  return { rooms: rooms ?? DEFAULT_OFFICE_ROOMS.map((r) => ({ ...r })) };
}

/**
 * Qualcuno sta lavorando davvero: una sessione attiva al lavoro (pallino verde) o in attesa (rosso); quelle ferme
 * (grigio) no. Finché è così l'ufficio non si ricompone (stessa regola di office_locked in main.rs). Pura.
 */
export function officeBusy(sessions: readonly Pick<SessionState, 'active' | 'dot'>[]): boolean {
  return sessions.some((s) => s.active && (s.dot === 'working' || s.dot === 'waiting'));
}

/** Chiave stabile di una composizione, per confronti e cache. */
export const officeKey = (rooms: readonly OfficeRoom[]): string => rooms.map((r) => `${r.type}:${r.variant ?? '*'}`).join(',');
