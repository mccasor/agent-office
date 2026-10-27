/**
 * Finestra di contesto per prefisso del model id, vince il primo che corrisponde. Suffisso "[1m]" = variante 1M.
 * Dal catalogo di Claude Code 2.1.311: fino a Opus 4.6, Sonnet 4.6 e Haiku 4.5 la finestra standard è 200k,
 * da Opus 4.7, Sonnet 5, Haiku 5.5, Fable e Mythos è nativa da 1M (anche senza suffisso).
 */
const WINDOWS: ReadonlyArray<[prefix: string, window: number]> = [
  ['claude-3', 200_000],
  ['claude-opus-4-0', 200_000],
  ['claude-opus-4-1', 200_000],
  ['claude-opus-4-5', 200_000],
  ['claude-opus-4-6', 200_000],
  ['claude-opus-4-2025', 200_000],
  ['claude-sonnet-4', 200_000],
  ['claude-haiku-4', 200_000],
  ['claude-opus', 1_000_000],
  ['claude-sonnet', 1_000_000],
  ['claude-haiku', 1_000_000],
  ['claude-fable', 1_000_000],
  ['claude-mythos', 1_000_000],
];

const ONE_M_SUFFIX = '[1m]';

/**
 * Fonti della variante 1M, in ordine:
 * 1. suffisso "[1m]" nel model id;
 * 2. `declared`: modelId dell'attachment "model" del transcript, se ha il suffisso "[1m]" e si riferisce
 *    allo stesso modello (verificato su Claude Code 2.1.278: "claude-opus-5[1m]"). È solo un segnale positivo:
 *    su 2.1.292/2.1.306 l'attachment riporta il model id senza suffisso anche in sessioni oltre 200k;
 * 3. euristica: `used` oltre la finestra standard. Prima di superarla una sessione 1M senza (1)/(2) appare /200k:
 *    nessun'altra fonte affidabile (settings.json, api-request params/betas, ~/.claude.json) lo indica.
 */
export function contextWindowFor(model: string | null, used = 0, declared: string | null = null): number | null {
  if (!model) return null;
  const id = model.toLowerCase();
  const known = WINDOWS.find(([prefix]) => id.startsWith(prefix));
  if (!known) return null;
  const decl = declared?.toLowerCase() ?? '';
  const declared1m = decl.endsWith(ONE_M_SUFFIX) && id.startsWith(decl.slice(0, -ONE_M_SUFFIX.length));
  return id.endsWith(ONE_M_SUFFIX) || declared1m || used > known[1] ? 1_000_000 : known[1];
}
