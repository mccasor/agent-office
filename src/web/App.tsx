import { useCallback, useEffect, useMemo, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { AgentState } from '../shared/types';
import { AgentActor, AlertBubble, DESK_CUP, Office, PostIt, StartQueue, TaskBoards, type CardPlace, type Seat, type TaskCard } from './scene';
import { bossPreset, Character, CoffeeCup, pickPreset, type CharacterPreset } from './characters';
import { AgentLabel, HudOverlay, type Waiting, ListView, RepoPanel, SessionPanel, sessionDot, ViewToggle } from './hud';
import { connectSnapshotStream, useOfficeStore, visibleSnapshot } from './store';
import { EMPTY_SEATING, officeModel } from './officeModel';
import { moveCard, syncBoard } from './board';
import './app.css';

/** animazioni semplici e lente: 30 fotogrammi al secondo bastano e dimezzano il lavoro di CPU e GPU */
const MAX_FPS = 30;

/** Con frameloop "demand": chiede un frame al massimo `fps` volte al secondo (le interazioni ne chiedono altri). */
function FrameLimiter({ fps }: { fps: number }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    let raf = 0;
    let last = -Infinity;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      // tolleranza di 2 ms: a 60 Hz un frame sì e uno no anche con piccole irregolarità del vsync
      if (t - last >= 1000 / fps - 2) {
        last = t;
        invalidate();
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [fps, invalidate]);
  return null;
}

export function App() {
  const fullSnapshot = useOfficeStore((s) => s.snapshot);
  const connected = useOfficeStore((s) => s.connected);
  const viewMode = useOfficeStore((s) => s.view);
  const setViewMode = useOfficeStore((s) => s.setView);
  const hidden = useOfficeStore((s) => s.hiddenSessions);
  const toggleSession = useOfficeStore((s) => s.toggleSession);
  // l'ufficio mostra solo le sessioni scelte nella vista lista
  const snapshot = useMemo(() => visibleSnapshot(fullSnapshot, hidden), [fullSnapshot, hidden]);
  // posti ricalcolati solo quando arriva un nuovo snapshot, partendo dai precedenti (posti stabili)
  const [view, setView] = useState(() => {
    const model = officeModel(snapshot, EMPTY_SEATING);
    return { snapshot, model, board: syncBoard({}, model.agents) };
  });
  if (view.snapshot !== snapshot) {
    const model = officeModel(snapshot, view.model);
    setView({ snapshot, model, board: syncBoard(view.board, model.agents) });
  }
  const { model, board } = view;
  // turni di partenza condivisi: chi entra (o esce) insieme sfila in fila indiana invece di sovrapporsi
  const [queue] = useState(() => new StartQueue());
  const onCard = useCallback((id: string, place: CardPlace) => setView((v) => ({ ...v, board: moveCard(v.board, id, place) })), []);

  useEffect(() => connectSnapshotStream(), []);
  // finestra nascosta (app della menu bar) o scheda in background: niente frame da disegnare
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState !== 'hidden');
  useEffect(() => {
    const update = () => setPageVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  const { layout } = model;
  const drawing = viewMode === 'office' && pageVisible;
  // motivo e inizio del blocco delle sessioni bloccate, per Claudio Code
  const waiting = new Map(
    (snapshot?.sessions ?? []).filter((s) => s.active && s.waiting).map((s) => [s.id, { kind: s.waitingKind ?? null, since: s.waitingSince ?? null }]),
  );
  const shown = model.session;
  const shownStatus = shown ? sessionDot(shown, model.agents.filter((a) => a.sessionId === shown.id)) : 'idle';
  const span = Math.max(layout.width, layout.depth);

  return (
    <>
      {/* vista a 3/4 dall'angolo sud-est, come uno spaccato isometrico: pareti di fondo nord e ovest */}
      <Canvas
        shadows
        // su schermi retina il pieno dpr quadruplica i pixel da disegnare senza un guadagno visibile
        dpr={[1, 1.5]}
        camera={{ position: [span * 0.56, span * 0.66, span * 0.72], fov: 38 }}
        // in vista lista la scena resta montata (posizioni e post-it intatti) ma non viene disegnata
        frameloop={drawing ? 'demand' : 'never'}
        style={{ display: viewMode === 'office' ? 'block' : 'none' }}
      >
        <color attach="background" args={['#eceef1']} />
        {drawing && <FrameLimiter fps={MAX_FPS} />}
        <Office layout={layout} />
        <TaskBoards layout={layout} cards={Object.values(board)} />
        {model.agents.map((agent) => (
          <Actor
            key={agent.id}
            agent={agent}
            preset={pickPreset(agent.id)}
            target={model.targets[agent.id] ?? null}
            layout={layout}
            card={board[agent.id] ?? null}
            onCard={onCard}
            queue={queue}
          />
        ))}
        {model.bosses.map((boss) => (
          <Actor
            key={boss.id}
            agent={boss}
            // camicia legata alla postazione: resta la stessa anche quando cambia l'ordine delle sessioni
            preset={bossPreset(Number(model.bossDesks[boss.id]?.slice('boss-'.length) ?? 0))}
            target={model.targets[boss.id] ?? null}
            layout={layout}
            queue={queue}
            waiting={waiting.get(boss.sessionId) ?? null}
          />
        ))}
        <OrbitControls makeDefault maxPolarAngle={Math.PI / 2.3} minDistance={5} maxDistance={span * 2} />
      </Canvas>
      {viewMode === 'list' && (
        <ListView
          sessions={fullSnapshot?.sessions ?? []}
          agents={fullSnapshot?.agents ?? []}
          finished={fullSnapshot?.finished ?? []}
          hidden={hidden}
          onToggle={toggleSession}
        />
      )}
      <HudOverlay side="left">{viewMode === 'office' && <SessionPanel session={shown} status={shownStatus} />}</HudOverlay>
      <HudOverlay side="right">
        <ViewToggle view={viewMode} onChange={setViewMode} />
        {/* con --all non c'è un repository unico: il branch di ogni sessione è nella vista lista */}
        {viewMode === 'office' && (snapshot?.repo || !model.session?.cwd) && <RepoPanel repo={snapshot?.repo ?? null} />}
        {!connected && <div className="hud-panel app-offline">Disconnesso: riconnessione…</div>}
      </HudOverlay>
    </>
  );
}

/**
 * Un agente (o Claudio Code) in scena: entra con la tazza di caffè fumante, la posa sulla scrivania quando si siede
 * e la riprende quando si alza; sui divani dell'area relax la tiene in mano. Gli agenti con un post-it passano dalle
 * board: entrando lo spostano da "to do" a "in progress", andando via da "in progress" a "in review".
 */
function Actor({ agent, preset, target, layout, card = null, onCard, queue, waiting = null }: {
  agent: AgentState;
  preset: CharacterPreset;
  target: Seat | null;
  layout: ReturnType<typeof officeModel>['layout'];
  card?: TaskCard | null;
  onCard?: (id: string, place: CardPlace) => void;
  queue?: StartQueue;
  /** sessione bloccata in attesa dell'utente: fumetto "!" ed etichetta in rosso */
  waiting?: Waiting | null;
}) {
  const move = useCallback((place: CardPlace) => onCard?.(agent.id, place), [onCard, agent.id]);
  return (
    <AgentActor layout={layout} target={target} card={card?.place ?? null} onCard={move} queue={queue}>
      {(motion) => {
        const atDesk = motion.seated && /^(seat|boss)-/.test(motion.seatId ?? '');
        return (
          <>
            <Character
              preset={preset}
              walking={motion.walking}
              seated={motion.seated}
              holding={!atDesk}
              typing={atDesk}
              reaching={motion.reaching}
              leftHand={card?.place === 'carry' ? <PostIt card={card} size={0.2} /> : undefined}
            />
            {atDesk && <CoffeeCup position={DESK_CUP} />}
            <AgentLabel agent={agent} position={[0, 1.6, 0]} waiting={waiting} />
            {waiting && <AlertBubble />}
          </>
        );
      }}
    </AgentActor>
  );
}
