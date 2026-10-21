/** Finestra di contesto per prefisso del model id. Suffisso "[1m]" = variante 1M. */
const WINDOWS: ReadonlyArray<[prefix: string, window: number]> = [
  ['claude-opus', 200_000],
  ['claude-sonnet', 200_000],
  ['claude-haiku', 200_000],
];

/** `used` oltre la finestra standard implica la variante 1M (il transcript non riporta il suffisso "[1m]"). */
export function contextWindowFor(model: string | null, used = 0): number | null {
  if (!model) return null;
  const id = model.toLowerCase();
  const known = WINDOWS.find(([prefix]) => id.startsWith(prefix));
  if (!known) return null;
  return id.endsWith('[1m]') || used > known[1] ? 1_000_000 : known[1];
}
