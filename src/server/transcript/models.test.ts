import { describe, expect, it } from 'vitest';
import { contextWindowFor } from './models.js';

describe('contextWindowFor', () => {
  it.each([
    ['claude-opus-4-5', 200_000],
    ['claude-sonnet-4-5-20250929', 200_000],
    ['claude-haiku-4-5', 200_000],
    ['claude-opus-5-5', 200_000],
    ['claude-opus-4-6[1m]', 1_000_000],
    ['claude-sonnet-4-5[1M]', 1_000_000],
    // prefisso confrontato senza distinzione di maiuscole
    ['Claude-Opus-4-5', 200_000],
    // "[1m]" non basta: il modello deve essere noto
    ['gpt-4o[1m]', null],
    ['', null],
    ['gpt-4o', null],
    ['<synthetic>', null],
    [null, null],
  ] as const)('%s -> %s', (model, expected) => {
    expect(contextWindowFor(model)).toBe(expected);
  });

  it('contesto usato oltre 200k senza suffisso [1m] -> variante 1M', () => {
    expect(contextWindowFor('claude-opus-5-5', 223_575)).toBe(1_000_000);
    expect(contextWindowFor('claude-opus-5-5', 150_000)).toBe(200_000);
    // al limite esatto della finestra standard non c'è ancora prova della variante 1M
    expect(contextWindowFor('claude-opus-5-5', 200_000)).toBe(200_000);
    expect(contextWindowFor('claude-opus-5-5', 200_001)).toBe(1_000_000);
    expect(contextWindowFor('gpt-4o', 300_000)).toBeNull();
  });

  it('modello dichiarato con suffisso [1m] (attachment "model") -> variante 1M anche sotto 200k', () => {
    expect(contextWindowFor('claude-opus-5', 50_000, 'claude-opus-5[1m]')).toBe(1_000_000);
    expect(contextWindowFor('claude-sonnet-4-5-20250929', 0, 'claude-sonnet-4-5[1M]')).toBe(1_000_000);
    // dichiarazione senza suffisso: nessuna informazione, resta l'euristica
    expect(contextWindowFor('claude-opus-5-5', 50_000, 'claude-opus-5-5')).toBe(200_000);
    // dichiarazione relativa a un altro modello (cambio /model): ignorata
    expect(contextWindowFor('claude-haiku-4-5', 50_000, 'claude-opus-5[1m]')).toBe(200_000);
    // modello sconosciuto: nessuna finestra anche se la dichiarazione è 1M
    expect(contextWindowFor('gpt-4o', 0, 'gpt-4o[1m]')).toBeNull();
  });
});
