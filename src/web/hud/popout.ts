/** Scheda staccabile (#92): la scheda di un agente o le informazioni di un'istanza in una finestra a sé. */
export type CardKind = 'agent' | 'session';

/** Scheda delle informazioni sull'istanza (#109): "Istanza" (com'era prima) o "Git". */
export type InstanceTab = 'instance' | 'git';

/** Scheda chiesta dall'URL (`?card=agent|session&id=...`); null nella pagina normale. Pura. */
export function cardFromSearch(search: string): { kind: CardKind; id: string } | null {
  const p = new URLSearchParams(search);
  const kind = p.get('card');
  const id = p.get('id');
  if ((kind !== 'agent' && kind !== 'session') || !id) return null;
  return { kind, id };
}

/** Scheda dell'istanza chiesta dall'URL (`&tab=git`); null se non c'è. Pura. */
export function tabFromSearch(search: string): InstanceTab | null {
  const tab = new URLSearchParams(search).get('tab');
  return tab === 'git' || tab === 'instance' ? tab : null;
}

/** URL della finestra della scheda, sullo stesso server della pagina; `tab`: scheda dell'istanza da mostrare. */
export function cardUrl(kind: CardKind, id: string, origin = globalThis.location.origin, tab?: InstanceTab): string {
  return `${origin}/?card=${kind}&id=${encodeURIComponent(id)}${tab ? `&tab=${tab}` : ''}`;
}

/** Nome della finestra, uno per scheda: riaprire la stessa scheda riporta in primo piano quella già aperta. */
export function cardWindowName(kind: CardKind, id: string): string {
  return `agent-office-${kind}-${id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

/** chiave di localStorage con la scheda chiesta per la finestra di un'istanza */
export const tabKey = (sessionId: string): string => `agent-office:tab:${sessionId}`;
/** una richiesta di scheda vale per pochi secondi: il tempo di aprire la finestra */
const TAB_REQUEST_MS = 10_000;

/**
 * Chiede alla finestra dell'istanza di mostrare la scheda `tab`. L'URL non basta: l'app della menu bar ricostruisce
 * l'URL della scheda con i soli `card` e `id`, e una finestra già aperta non lo ricarica. Le finestre hanno la stessa
 * origine, quindi lo stesso localStorage: quella già aperta riceve l'evento `storage`, quella nuova lo legge all'avvio.
 */
export function requestTab(sessionId: string, tab: InstanceTab, now = Date.now()): void {
  try {
    localStorage.setItem(tabKey(sessionId), JSON.stringify({ tab, at: now }));
  } catch {
    // storage non disponibile: resta il parametro dell'URL
  }
}

/** Scheda chiesta da poco per la finestra dell'istanza (valore scritto da requestTab), o null. Pura. */
export function requestedTab(raw: string | null, now = Date.now()): InstanceTab | null {
  try {
    const v: unknown = JSON.parse(raw ?? 'null');
    if (typeof v !== 'object' || v === null) return null;
    const { tab, at } = v as { tab?: unknown; at?: unknown };
    return (tab === 'git' || tab === 'instance') && typeof at === 'number' && Math.abs(now - at) <= TAB_REQUEST_MS ? tab : null;
  } catch {
    return null;
  }
}

/** Apre (o porta in primo piano) la finestra della scheda; nell'app della menu bar la crea Tauri. L'altezza è una
 *  stima: la pagina della scheda si porta poi a misura del contenuto (fit.ts). Con `tab` la finestra di un'istanza
 *  si apre su quella scheda (#109). */
export function openCardWindow(kind: CardKind, id: string, tab?: InstanceTab): void {
  const size = kind === 'agent' ? 'width=360,height=480' : 'width=380,height=360';
  if (tab && kind === 'session') requestTab(id, tab);
  window.open(cardUrl(kind, id, undefined, tab), cardWindowName(kind, id), `popup,${size}`)?.focus();
}
