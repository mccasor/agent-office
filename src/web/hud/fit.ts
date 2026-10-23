/**
 * Finestra della scheda staccata (#92) a misura del contenuto: niente spazio vuoto sotto, al massimo l'85% dello
 * schermo (oltre si scorre). Nel browser la pagina ridimensiona il proprio popup (`window.resizeBy`); nell'app della
 * menu bar WKWebView ignora `resizeBy`, quindi l'altezza desiderata viaggia nel titolo della pagina, che l'app legge
 * già per dare il nome alla finestra: `<nome>` + SEPARATORE + `<altezza>-<n>` (n da 0 a 9 cambia a ogni richiesta,
 * così anche la stessa altezza chiesta di nuovo cambia il titolo). L'app toglie la coda dal titolo della finestra.
 */

/** altezza minima della finestra (come `min_inner_size` dell'app) */
export const MIN_HEIGHT = 280;
/** frazione massima dell'altezza dello schermo */
export const MAX_SCREEN_FRACTION = 0.85;
/** ci si restringe solo oltre questa differenza (px), per non sfarfallare; si cresce sempre */
export const SHRINK_SLACK = 24;
/** carattere di uso privato: non compare nei nomi di agenti e progetti */
export const TITLE_SEPARATOR = '';

/** Altezza desiderata del contenuto: intera, tra il minimo e il massimo (`max` vince sul minimo). Pura. */
export function fitHeight(content: number, max: number, min = MIN_HEIGHT): number {
  return Math.max(Math.min(Math.ceil(content), Math.floor(max)), Math.min(min, Math.floor(max)));
}

/** Va ridimensionata? Sempre se il contenuto non ci sta, solo oltre la soglia se avanza spazio. Pura. */
export function shouldResize(current: number, desired: number, slack = SHRINK_SLACK): boolean {
  return desired > current || current - desired > slack;
}

/** Titolo della pagina per l'app: nome e altezza desiderata. Pura. */
export function appTitle(name: string, height: number, seq: number): string {
  return `${name}${TITLE_SEPARATOR}${Math.round(height)}-${seq % 10}`;
}

/** La pagina è nella finestra dell'app (che aggiunge `app=1` all'URL della scheda). Pura. */
export function inApp(search: string): boolean {
  return new URLSearchParams(search).get('app') === '1';
}

/**
 * Segue l'altezza dell'elemento: a ogni cambiamento vero chiama `apply` con l'altezza desiderata, se la finestra va
 * ridimensionata. Restituisce la funzione per smettere. `max` e `current` si leggono a ogni misura (schermo e
 * finestra possono cambiare); la larghezza della finestra non c'entra: se l'utente la ridimensiona a mano resta così
 * finché non cambia il contenuto.
 */
export function followHeight(
  el: HTMLElement,
  read: () => { max: number; current: number },
  apply: (desired: number) => void,
): () => void {
  let last = -1;
  const measure = () => {
    const content = Math.ceil(el.getBoundingClientRect().height);
    if (content === last) return;
    last = content;
    const { max, current } = read();
    const desired = fitHeight(content, max);
    if (shouldResize(current, desired)) apply(desired);
  };
  measure();
  if (typeof ResizeObserver === 'undefined') return () => {};
  const observer = new ResizeObserver(measure);
  observer.observe(el);
  return () => observer.disconnect();
}
