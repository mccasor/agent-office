import { isShown, type DisplaySettings } from '../../shared/settings';
import type { WorkArea } from '../../shared/types';
import { agentName, AREA_LABEL } from '../hud/labels';
import type { PixelActor } from './types';

/**
 * Etichette dei nomi nella vista 2D (#88), disegnate nel canvas a risoluzione fisica: restano nitide e della stessa
 * grandezza (in pixel CSS) a ogni zoom e seguono i personaggi senza DOM da riposizionare a ogni fotogramma.
 * Colori presi dalle variabili dell'HUD, così chiaro/scuro e ruoli coincidono con scheda, accordion e lista.
 */

/** misure in pixel CSS (moltiplicate per il dpr al disegno) */
export const LABEL = {
  font: 11,
  chipFont: 9,
  height: 18,
  padX: 6,
  gap: 5,
  chipPadX: 5,
  chipHeight: 12,
  radius: 6,
  /** freccina sotto la targhetta, verso la testa */
  tail: 3,
  maxChars: 22,
} as const;

/** sopra questo zoom (pixel CSS per pixel dello sprite) c'è posto per l'etichetta di tutti, non solo boss e selezionato */
export const ALL_LABELS_ZOOM = 5;

export interface LabelTheme {
  bg: string;
  fg: string;
  border: string;
  accent: string;
  danger: string;
  areas: Record<WorkArea, string>;
}

const AREAS = Object.keys(AREA_LABEL) as WorkArea[];

/** colori di riserva (tema chiaro) se le variabili CSS non ci sono */
const FALLBACK: LabelTheme = {
  bg: 'rgb(255 255 255 / 0.94)',
  fg: '#1b1f24',
  border: 'rgb(0 0 0 / 0.18)',
  accent: '#2f6fde',
  danger: '#d4380d',
  areas: {
    backend: '#2f6fde', frontend: '#c2399a', design: '#6f8f00', architecture: '#7b4ddb', test: '#2e9d57', docs: '#b8860b',
    devops: '#d4580d', research: '#0e8f9c', other: '#6b7380',
  },
};

/** tema dalle variabili CSS (`read` restituisce '' per quelle mancanti) */
export function themeFrom(read: (name: string) => string): LabelTheme {
  const v = (name: string, fallback: string) => read(name).trim() || fallback;
  return {
    bg: v('--hud-bg', FALLBACK.bg),
    fg: v('--hud-fg', FALLBACK.fg),
    border: v('--hud-border', FALLBACK.border),
    accent: v('--hud-accent', FALLBACK.accent),
    danger: v('--hud-danger', FALLBACK.danger),
    areas: Object.fromEntries(AREAS.map((a) => [a, v(`--area-${a}`, FALLBACK.areas[a])])) as Record<WorkArea, string>,
  };
}

let cached: LabelTheme | null = null;
/** tema corrente, riletto quando cambia lo schema chiaro/scuro del sistema */
export function labelTheme(): LabelTheme {
  if (cached) return cached;
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return FALLBACK;
  const style = getComputedStyle(document.documentElement);
  cached = themeFrom((name) => style.getPropertyValue(name));
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => (cached = null), { once: true });
  return cached;
}

/** nome accorciato per la targhetta */
export const labelText = (name: string): string => (name.length > LABEL.maxChars ? `${name.slice(0, LABEL.maxChars - 1)}…` : name);

export interface LabelSpec {
  text: string;
  /** ruolo accanto al nome; null = solo il nome (Claudio Code, etichette compatte) */
  area: WorkArea | null;
  selected: boolean;
  waiting: boolean;
}

/** Voci delle impostazioni (#94) che toccano l'ufficio: nomi, ruolo, fumetto di chi aspetta, "!" degli avvisi. */
export interface OfficeShow {
  labels: boolean;
  role: boolean;
  bubbles: boolean;
  alerts: boolean;
}

/** Voci dell'ufficio dalle preferenze. Pura. */
export const officeShow = (settings: Pick<DisplaySettings, 'show'>): OfficeShow => ({
  labels: isShown(settings, 'office.labels'),
  role: isShown(settings, 'agent.role'),
  bubbles: isShown(settings, 'office.bubbles'),
  alerts: isShown(settings, 'agent.alerts'),
});

/** Fumetto sopra la testa: rosso se bloccato sull'utente, giallo con l'avviso (fermo o in loop). */
export type HeadMark = 'waiting' | 'alert';

/** Quel che va sopra la testa di un personaggio: targhetta (o null) e fumetto (o null). */
export interface ActorTag {
  spec: LabelSpec | null;
  mark: HeadMark | null;
}

/**
 * Targhetta e fumetto di un personaggio, secondo le impostazioni; null se sopra la testa non c'è niente. La targhetta
 * c'è per tutti (`everyone`, zoom ampio) o per boss, bloccati, avvisati e selezionato; il ruolo solo per i subagenti in
 * evidenza. Con le voci spente spariscono nomi, ruolo, fumetto rosso o "!" giallo; un avviso spento non mette più in
 * evidenza il personaggio. Pura.
 */
export function actorTag(actor: Pick<PixelActor, 'agent' | 'boss' | 'waiting' | 'alert'>, selected: boolean, everyone: boolean, show: OfficeShow): ActorTag | null {
  const alert = actor.alert && show.alerts;
  const mark = actor.waiting ? (show.bubbles ? 'waiting' : null) : alert ? 'alert' : null;
  const labelled = show.labels && (everyone || selected || actor.boss || actor.waiting || alert);
  if (!labelled && !mark) return null;
  const spec: LabelSpec | null = labelled
    ? {
      text: labelText(agentName(actor.agent)),
      // il ruolo per i subagenti in evidenza; Claudio Code è il capo, il suo nome basta
      area: !show.role || actor.boss || (everyone && !selected && !actor.waiting) ? null : actor.agent.area,
      selected,
      waiting: actor.waiting,
    }
    : null;
  return { spec, mark };
}

export interface LabelBox {
  left: number;
  top: number;
  w: number;
  h: number;
  /** larghezza del testo e della chip del ruolo (0 senza) */
  textW: number;
  chipW: number;
}

/**
 * Riquadro della targhetta in pixel fisici: centrata in `cx`, con la punta della freccina in `bottom`. `measure`
 * misura il testo (pixel fisici) con il font già impostato: per nome e chip è chiamata con i rispettivi font.
 */
export function labelBox(spec: LabelSpec, cx: number, bottom: number, dpr: number, measure: (text: string, chip: boolean) => number): LabelBox {
  const k = (n: number) => Math.round(n * dpr);
  const textW = Math.ceil(measure(spec.text, false));
  const chipW = spec.area ? Math.ceil(measure(AREA_LABEL[spec.area], true)) + 2 * k(LABEL.chipPadX) : 0;
  const w = textW + 2 * k(LABEL.padX) + (chipW ? chipW + k(LABEL.gap) : 0);
  const h = k(LABEL.height);
  return { left: Math.round(cx - w / 2), top: Math.round(bottom - k(LABEL.tail) - h), w, h, textW, chipW };
}

const fontOf = (size: number, dpr: number, weight: number) =>
  `${weight} ${Math.round(size * dpr)}px system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;

/** Disegna la targhetta: fondo dell'HUD, angoli arrotondati, bordo (accento se selezionato, rosso se bloccato). */
export function drawLabel(ctx: CanvasRenderingContext2D, spec: LabelSpec, cx: number, bottom: number, dpr: number, theme = labelTheme()): void {
  const k = (n: number) => Math.round(n * dpr);
  const nameFont = fontOf(LABEL.font, dpr, 600);
  const chipFont = fontOf(LABEL.chipFont, dpr, 700);
  const box = labelBox(spec, cx, bottom, dpr, (text, chip) => {
    ctx.font = chip ? chipFont : nameFont;
    return ctx.measureText(text).width;
  });
  const { left, top, w, h } = box;
  const edge = spec.waiting ? theme.danger : spec.selected ? theme.accent : theme.border;
  const line = spec.selected || spec.waiting ? Math.max(2, k(1.5)) : Math.max(1, k(1));

  // targhetta con la freccina al centro in basso
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(left + line / 2, top + line / 2, w - line, h - line, k(LABEL.radius));
  ctx.fillStyle = theme.bg;
  ctx.fill();
  ctx.lineWidth = line;
  ctx.strokeStyle = edge;
  ctx.stroke();
  ctx.beginPath();
  const tail = k(LABEL.tail);
  ctx.moveTo(cx - tail - 1, top + h - line);
  ctx.lineTo(cx, top + h + tail);
  ctx.lineTo(cx + tail + 1, top + h - line);
  ctx.closePath();
  ctx.fillStyle = spec.selected || spec.waiting ? edge : theme.bg;
  ctx.fill();

  // nome
  const mid = top + h / 2;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = nameFont;
  ctx.fillStyle = spec.waiting ? theme.danger : theme.fg;
  ctx.fillText(spec.text, left + k(LABEL.padX), mid + Math.round(dpr / 2));

  // chip del ruolo: fondo tenue e bordo del colore dell'area, come .hud-chip
  if (spec.area && box.chipW) {
    const color = theme.areas[spec.area];
    const cl = left + k(LABEL.padX) + box.textW + k(LABEL.gap);
    const ch = k(LABEL.chipHeight);
    const ct = Math.round(mid - ch / 2);
    ctx.beginPath();
    ctx.roundRect(cl, ct, box.chipW, ch, ch / 2);
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = Math.max(1, k(1));
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.font = chipFont;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(AREA_LABEL[spec.area], cl + box.chipW / 2, mid + Math.round(dpr / 2));
  }
  ctx.restore();
}
