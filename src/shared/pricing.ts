import type { TokenUsage } from './types.js';

/** Prezzi in dollari per milione di token: input, output, lettura e scrittura della cache (5 minuti e 1 ora). */
interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h: number;
}

// scrittura della cache: 1,25x l'input per 5 minuti, 2x per 1 ora (documentazione dei prezzi Anthropic)
const price = (input: number, output: number, cacheRead = input * 0.1): Price => ({
  input,
  output,
  cacheRead,
  cacheWrite: input * 1.25,
  cacheWrite1h: input * 2,
});

/**
 * Listino dell'API Anthropic (prezzi pubblici di prima parte, ottobre 2026), dal prefisso più specifico.
 * È una stima: non considera la fascia oltre 100K token di Haiku 5.5 né `inference_geo`.
 */
const PRICES: [prefix: string, price: Price][] = [
  ['claude-fable-5-1', price(10, 50, 0.25)],
  ['claude-mythos-5-1', price(10, 50, 0.25)],
  ['claude-fable-5', price(10, 50, 1)],
  ['claude-mythos-5', price(10, 50, 1)],
  ['claude-opus-5-5', price(4, 20, 0.2)],
  ['claude-opus-5', price(5, 25)],
  ['claude-opus-4-8', price(5, 25)],
  ['claude-opus-4-7', price(5, 25)],
  ['claude-opus-4-6', price(5, 25)],
  ['claude-opus-4-5', price(5, 25)],
  ['claude-opus-4', price(15, 75)],
  ['claude-sonnet-5-5', price(2, 10, 0.1)],
  ['claude-sonnet-5', price(2, 10, 0.2)],
  ['claude-sonnet-4', price(3, 15)],
  ['claude-haiku-5-5', price(0.1, 0.5)],
  ['claude-haiku-4-5', price(1, 5)],
];

/** Costo stimato in dollari dei token usati con `model`; null se il modello non è nel listino. */
export function estimateCost(model: string | null, tokens: TokenUsage): number | null {
  if (!model) return null;
  // "claude-opus-5-5[1m]", "claude-sonnet-4-5-20250929", "us.anthropic.claude-…" -> prefisso del listino
  const id = model.toLowerCase().replace(/^.*?(claude-)/, '$1');
  const p = PRICES.find(([prefix]) => id.startsWith(prefix))?.[1];
  if (!p) return null;
  // la parte scritta nella cache da 1 ora costa di più; senza il dettaglio (client vecchi) tutto a 5 minuti
  const write1h = Math.min(tokens.cacheCreation1h ?? 0, tokens.cacheCreation);
  const write5m = tokens.cacheCreation - write1h;
  return (
    (tokens.input * p.input + tokens.output * p.output + tokens.cacheRead * p.cacheRead + write5m * p.cacheWrite + write1h * p.cacheWrite1h) /
    1_000_000
  );
}
