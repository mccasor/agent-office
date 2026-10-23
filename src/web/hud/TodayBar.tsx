import type { DayStats } from '../../shared/types';
import { useShow } from '../store';
import { formatCost, formatDuration } from './format';
import { plural, TODAY_HINT, TODAY_LABEL, TODAY_TITLE } from './labels';
import './hud.css';

interface Item {
  key: 'cost' | 'hour' | 'launched' | 'finished' | 'failed' | 'waiting';
  value: string;
  label: string;
  /** in evidenza (agenti falliti) */
  alarm?: boolean;
}

/** Voci della barra: costo di oggi e dell'ultima ora, agenti lanciati, terminati e falliti, tempo in attesa. Pura. */
export function todayItems(t: DayStats): Item[] {
  return [
    { key: 'cost', value: formatCost(t.cost), label: TODAY_LABEL.cost },
    { key: 'hour', value: `${formatCost(t.costLastHour)}${TODAY_LABEL.perHour}`, label: TODAY_LABEL.lastHour },
    { key: 'launched', value: String(t.launched), label: plural(t.launched, TODAY_LABEL.launched) },
    { key: 'finished', value: String(t.finished), label: plural(t.finished, TODAY_LABEL.finished) },
    { key: 'failed', value: String(t.failed), label: plural(t.failed, TODAY_LABEL.failed), alarm: t.failed > 0 },
    { key: 'waiting', value: t.waitingMs > 0 ? formatDuration(t.waitingMs) : TODAY_LABEL.noWait, label: TODAY_LABEL.waiting },
  ];
}

/**
 * Cruscotto della giornata (#97): in cima alla lista una riga di valori con l'etichetta sotto; `compact` per
 * l'ufficio, una riga sola e discreta sopra l'HUD ("Oggi ≈ $3,40 · ≈ $0,25/h · 5 lanciati ..."). Numeri calcolati
 * dal server (snapshot.today); il tooltip ne dice i limiti. Le due forme si spengono a parte (`today.list`, `today.office`).
 */
export function TodayBar({ today, compact = false }: { today: DayStats; compact?: boolean }) {
  const shown = useShow(compact ? 'today.office' : 'today.list');
  const items = todayItems(today);
  if (!shown) return null;
  if (compact) {
    return (
      <p className="hud-panel today-bar today-bar--compact" aria-label={TODAY_TITLE} title={TODAY_HINT}>
        <strong>{TODAY_TITLE}</strong>
        {items.map((i) => (
          <span key={i.key} className={i.alarm ? 'today-bar__alarm' : undefined}>
            {/* costo e costo orario parlano da sé */}
            {i.key === 'cost' || i.key === 'hour' ? i.value : `${i.value} ${i.label}`}
          </span>
        ))}
      </p>
    );
  }
  return (
    <section className="today-bar" aria-label={TODAY_TITLE} title={TODAY_HINT}>
      <h2 className="today-bar__title">{TODAY_TITLE}</h2>
      <dl className="today-bar__items">
        {items.map((i) => (
          <div key={i.key} className={`today-bar__item${i.alarm ? ' today-bar__alarm' : ''}`} data-kpi={i.key}>
            <dd>{i.value}</dd>
            <dt>{i.label}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}
