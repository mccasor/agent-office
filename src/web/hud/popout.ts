/** Scheda staccabile (#92): la scheda di un agente o le informazioni di un'istanza in una finestra a sé. */
export type CardKind = 'agent' | 'session';

/** Scheda chiesta dall'URL (`?card=agent|session&id=...`); null nella pagina normale. Pura. */
export function cardFromSearch(search: string): { kind: CardKind; id: string } | null {
  const p = new URLSearchParams(search);
  const kind = p.get('card');
  const id = p.get('id');
  if ((kind !== 'agent' && kind !== 'session') || !id) return null;
  return { kind, id };
}

/** URL della finestra della scheda, sullo stesso server della pagina. */
export function cardUrl(kind: CardKind, id: string, origin = globalThis.location.origin): string {
  return `${origin}/?card=${kind}&id=${encodeURIComponent(id)}`;
}

/** Nome della finestra, uno per scheda: riaprire la stessa scheda riporta in primo piano quella già aperta. */
export function cardWindowName(kind: CardKind, id: string): string {
  return `agent-office-${kind}-${id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

/** Apre (o porta in primo piano) la finestra della scheda; nell'app della menu bar la crea Tauri. */
export function openCardWindow(kind: CardKind, id: string): void {
  const size = kind === 'agent' ? 'width=360,height=640' : 'width=380,height=600';
  window.open(cardUrl(kind, id), cardWindowName(kind, id), `popup,${size}`)?.focus();
}
