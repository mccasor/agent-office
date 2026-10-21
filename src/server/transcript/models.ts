/** Finestra di contesto per prefisso del model id. Suffisso "[1m]" = variante 1M. */
const WINDOWS: ReadonlyArray<[prefix: string, window: number]> = [
  ['claude-opus', 200_000],
  ['claude-sonnet', 200_000],
  ['claude-haiku', 200_000],
];

export function contextWindowFor(model: string | null): number | null {
  if (!model) return null;
  const id = model.toLowerCase();
  const known = WINDOWS.find(([prefix]) => id.startsWith(prefix));
  if (!known) return null;
  return id.endsWith('[1m]') ? 1_000_000 : known[1];
}
