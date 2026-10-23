import { useCallback, useEffect, useMemo, useState } from 'react';
import { AgentCard, HudOverlay, InstancesPanel, ListView, ViewToggle } from './hud';
import { connectSnapshotStream, useOfficeStore, visibleSnapshot } from './store';
import { BOSS_PREFIX, bossOf } from './pixel/boss';
import { PixelOffice } from './pixel/PixelOffice';
import { openCardWindow } from './hud/popout';
import './app.css';

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
  const closeCard = useCallback(() => select(null), [select]);
  // scheda staccata in una finestra a sé: qui si chiude, l'ufficio resta libero
  const popOutCard = useCallback(() => {
    if (!selectedId) return;
    openCardWindow('agent', selectedId);
    select(null);
  }, [selectedId, select]);
  const popOutSession = useCallback((sessionId: string) => openCardWindow('session', sessionId), []);
  // l'ufficio mostra solo le sessioni scelte nella vista lista
  const snapshot = useMemo(() => visibleSnapshot(fullSnapshot, hidden), [fullSnapshot, hidden]);
  const agents = snapshot?.agents ?? [];
  // Claude stesso, uno per sessione attiva; con più sessioni il nome porta il progetto
  const bosses = useMemo(() => {
    const active = snapshot?.sessions.filter((s) => s.active) ?? [];
    return active.map((s) => bossOf(s, active.length > 1));
  }, [snapshot]);

  useEffect(() => connectSnapshotStream(), []);
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
          sessions={fullSnapshot?.sessions ?? []}
          agents={fullSnapshot?.agents ?? []}
          finished={fullSnapshot?.finished ?? []}
          hidden={hidden}
          onToggle={toggleSession}
          focus={focusSession}
        />
      )}
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
        {!connected && <div className="hud-panel app-offline">Disconnesso: riconnessione…</div>}
        {office && selected && <AgentCard agent={selected} session={selectedSession} onClose={closeCard} onPopOut={popOutCard} />}
      </HudOverlay>
    </>
  );
}
