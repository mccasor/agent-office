import type { DayStats } from '../../shared/types';
import { t, tn } from '../../shared/i18n';
import { useShow } from '../store';
import { formatCost, formatDuration } from './format';
import './hud.css';

interface Item {
  key: 'cost' | 'hour' | 'launched' | 'finished' | 'failed' | 'waiting';
  value: string;
  label: string;
  /** in evidenza (agenti falliti) */
  alarm?: boolean;
}

/**
 * Voci della barra: costo di oggi e dell'ultima ora, agenti lanciati, terminati e falliti, tempo in attesa. Etichette
 * al singolare o al plurale secondo il valore, che si mostra a parte ("5" sopra "lanciati": i testi `today.*` non
 * hanno `{n}`). Pura.
 */
export function todayItems(d: DayStats): Item[] {
  return [
    { key: 'cost', value: formatCost(d.cost), label: t('today.cost') },
    { key: 'hour', value: `${formatCost(d.costLastHour)}${t('today.perHour')}`, label: t('today.lastHour') },
    { key: 'launched', value: String(d.launched), label: tn('today.launched', d.launched) },
    { key: 'finished', value: String(d.finished), label: tn('today.finished', d.finished) },
    { key: 'failed', value: String(d.failed), label: tn('today.failed', d.failed), alarm: d.failed > 0 },
    { key: 'waiting', value: d.waitingMs > 0 ? formatDuration(d.waitingMs) : t('today.noWait'), label: t('today.waiting') },
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
      <p className="hud-panel today-bar today-bar--compact" aria-label={t('today.title')} title={t('today.hint')}>
        <strong>{t('today.title')}</strong>
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
    <section className="today-bar" aria-label={t('today.title')} title={t('today.hint')}>
      <h2 className="today-bar__title">{t('today.title')}</h2>
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
