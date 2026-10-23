/**
 * Nome di persona per ogni subagente (#88), nello spirito di "Claudio Code": un nome italiano e un cognome che
 * richiama il lavoro. Deterministico dall'id, così server, web e pannello della menu bar lo vedono uguale.
 * "Claudio" e "Code" restano a Claude stesso.
 */

export const FIRST_NAMES = [
  'Alba', 'Bruno', 'Carla', 'Dario', 'Elena', 'Fabio', 'Gaia', 'Guido', 'Ilaria', 'Ivo',
  'Lara', 'Leo', 'Livia', 'Marco', 'Marta', 'Nadia', 'Nico', 'Olga', 'Paolo', 'Pia',
  'Rita', 'Rocco', 'Sara', 'Silvio', 'Tea', 'Teo', 'Ugo', 'Vera', 'Walter', 'Zeno',
  'Anna', 'Bice', 'Ciro', 'Dora', 'Enzo', 'Flavia', 'Gino', 'Irene', 'Luca', 'Mirta',
] as const;

export const LAST_NAMES = [
  'Bug', 'Build', 'Byte', 'Cache', 'Commit', 'Compile', 'Cursor', 'Debug', 'Deploy', 'Diff',
  'Docker', 'Fetch', 'Fork', 'Git', 'Hash', 'Kernel', 'Lint', 'Loop', 'Merge', 'Patch',
  'Pipeline', 'Pixel', 'Prompt', 'Query', 'Push', 'Regex', 'Rebase', 'Refactor', 'Script', 'Shell',
  'Socket', 'Sprint', 'Stack', 'Syntax', 'Tag', 'Thread', 'Token', 'Typo', 'Vector', 'Widget',
] as const;

/** FNV-1a a 32 bit con il rimescolamento finale di MurmurHash3: id quasi uguali danno nomi diversi */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** "Marta Commit": nome e cognome scelti dall'id dell'agente */
export function nicknameOf(id: string): string {
  const h = hash(id);
  return `${FIRST_NAMES[h % FIRST_NAMES.length]!} ${LAST_NAMES[Math.floor(h / FIRST_NAMES.length) % LAST_NAMES.length]!}`;
}
