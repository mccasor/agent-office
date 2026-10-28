import { useCallback, useEffect, useMemo, useState } from 'react';
import { AgentCard, HudOverlay, InstancesPanel, ListView, ViewToggle } from './hud';
import { t } from '../shared/i18n';
import { connectSnapshotStream, isMarkedDone, useLocale, useOfficeStore, visibleSnapshot, watchMarkedDone } from './store';
import { BOSS_PREFIX, bossOf } from './pixel/boss';
import { PixelOffice } from './pixel/PixelOffice';
import { openCardWindow } from './hud/popout';
import { HistoryView } from './hud/HistoryView';
import { TodayBar } from './hud/TodayBar';
import './app.css';

/** pagina delle offerte, la stessa accettata da `cards::is_donate` nell'app */
const DONATE_URL = 'https://ko-fi.com/mccasor';

export function App() {
  const fullSnapshot = useOfficeStore((s) => s.snapshot);
  const connected = useOfficeStore((s) => s.connected);
  const viewMode = useOfficeStore((s) => s.view);
  const setViewMode = useOfficeStore((s) => s.setView);
  const hidden = useOfficeStore((s) => s.hiddenSessions);
  const toggleSession = useOfficeStore((s) => s.toggleSession);
  const focusSession = useOfficeStore((s) => s.focusSession);
  const selectedId = useOfficeStore((s) => s.selectedAgent);
  const select = useOfficeStore((s) => s.select);
  const marked = useOfficeStore((s) => s.markedDone);
  const markDone = useOfficeStore((s) => s.markDone);
  const unmarkDone = useOfficeStore((s) => s.unmarkDone);
  const closeCard = useCallback(() => select(null), [select]);
  // lingua (#93): cambiandola si ridisegna tutto, senza ricaricare (posizioni, schede aperte e filtri restano)
  useLocale();
  // scheda staccata in una finestra a sé: qui si chiude, l'ufficio resta libero
  const popOutCard = useCallback(() => {
    if (!selectedId) return;
    openCardWindow('agent', selectedId);
    select(null);
  }, [selectedId, select]);
  const popOutSession = useCallback((sessionId: string) => openCardWindow('session', sessionId), []);
  // l'ufficio mostra solo le sessioni scelte nella vista lista; ufficio e lista non mostrano chi è segnato come terminato
  const snapshot = useMemo(() => visibleSnapshot(fullSnapshot, hidden, marked), [fullSnapshot, hidden, marked]);
  const listed = useMemo(() => visibleSnapshot(fullSnapshot, [], marked), [fullSnapshot, marked]);
  const markSelected = useCallback(() => selectedId && markDone(selectedId), [selectedId, markDone]);
  // segnati come terminati: nella lista tra i terminati di oggi, con "Annulla" per farli rientrare (#104)
  const markedAgents = useMemo(() => fullSnapshot?.agents.filter((a) => isMarkedDone(a, marked)) ?? [], [fullSnapshot, marked]);
  const agents = snapshot?.agents ?? [];
  // Claude stesso, uno per sessione attiva; con più sessioni il nome porta il progetto
  const bosses = useMemo(() => {
    const active = snapshot?.sessions.filter((s) => s.active) ?? [];
    return active.map((s) => bossOf(s, active.length > 1));
  }, [snapshot]);

  useEffect(() => connectSnapshotStream(), []);
  // chi viene segnato come terminato (o rientra) da una scheda staccata sparisce (o ricompare) anche qui (#101)
  useEffect(() => watchMarkedDone(), []);
  // finestra nascosta (app della menu bar) o scheda in background: niente frame da disegnare
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState !== 'hidden');
  useEffect(() => {
    const update = () => setPageVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  // agente della scheda: in ufficio o già uscito (ultimo stato noto); sparito anche da lì, la scheda si chiude
  const selected = selectedId
    ? ([...agents, ...bosses, ...(snapshot?.finished ?? [])].find((a) => a.id === selectedId) ?? null)
    : null;
  const selectedSession = selected?.id.startsWith(BOSS_PREFIX) ? (snapshot?.sessions.find((s) => s.id === selected.sessionId) ?? null) : null;
  useEffect(() => {
    if (selectedId && !selected) select(null);
  }, [selectedId, selected, select]);
  // ufficio: pannello delle istanze a sinistra e scheda dell'agente a destra
  const office = viewMode === 'pixel';

  return (
    <>
      {/* montato solo quando è mostrato: chi ha già un posto ricompare seduto */}
      {office && <PixelOffice snapshot={snapshot} selectedId={selectedId} onSelect={select} active={pageVisible} />}
      {viewMode === 'list' && (
        <ListView
          sessions={listed?.sessions ?? []}
          agents={listed?.agents ?? []}
          finished={listed?.finished ?? []}
          closedFinished={fullSnapshot?.closedFinished}
          marked={markedAgents}
          hidden={hidden}
          onToggle={toggleSession}
          focus={focusSession}
          today={fullSnapshot?.today}
          onMarkDone={markDone}
          onUnmark={unmarkDone}
        />
      )}
      {viewMode === 'history' && <HistoryView />}
      <HudOverlay side="left">
        {office && (
          <InstancesPanel
            sessions={snapshot?.sessions ?? []}
            agents={agents}
            bosses={bosses}
            focus={focusSession}
            selected={selectedId}
            onSelect={select}
            onPopOut={popOutSession}
          />
        )}
      </HudOverlay>
      <HudOverlay side="right">
        <ViewToggle view={viewMode} onChange={setViewMode} />
        {!connected && <div className="hud-panel app-offline">{t('app.offline')}</div>}
        {/* cruscotto della giornata (#97), in breve: nella lista è in alto, per esteso */}
        {office && fullSnapshot?.today && <TodayBar today={fullSnapshot.today} compact />}
        {office && selected && (
          <AgentCard agent={selected} session={selectedSession} onClose={closeCard} onPopOut={popOutCard} onMarkDone={markSelected} />
        )}
      </HudOverlay>
      {/* offerta su Ko-fi: nell'app della menu bar il link si apre nel browser di sistema (cards.rs) */}
      <a className="app-donate" href={DONATE_URL} target="_blank" rel="noopener noreferrer" title={t('app.donateHint')}>
        ☕ {t('app.donate')}
      </a>
    </>
  );
}
