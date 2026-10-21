import { useCallback, useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { AgentState } from '../shared/types';
import { AgentActor, DESK_CUP, Office, PostIt, TaskBoards, type CardPlace, type Seat, type TaskCard } from './scene';
import { BOSS_PRESET, Character, CoffeeCup, pickPreset, type CharacterPreset } from './characters';
import { AgentLabel, HudOverlay, ListView, RepoPanel, SessionPanel, ViewToggle } from './hud';
import { connectSnapshotStream, useOfficeStore, visibleSnapshot } from './store';
import { officeModel } from './officeModel';
import { moveCard, syncBoard } from './board';
import './app.css';

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
    const model = officeModel(snapshot, { seats: {}, lounge: {}, capacity: 0 });
    return { snapshot, model, board: syncBoard({}, model.agents) };
  });
  if (view.snapshot !== snapshot) {
    const model = officeModel(snapshot, view.model);
    setView({ snapshot, model, board: syncBoard(view.board, model.agents) });
  }
  const { model, board } = view;
  const onCard = useCallback((id: string, place: CardPlace) => setView((v) => ({ ...v, board: moveCard(v.board, id, place) })), []);

  useEffect(() => connectSnapshotStream(), []);

  const { layout } = model;
  const span = Math.max(layout.width, layout.depth);

  return (
    <>
      {/* vista a 3/4 dall'angolo sud-est, come uno spaccato isometrico: pareti di fondo nord e ovest */}
      <Canvas
        shadows
        camera={{ position: [span * 0.5, span * 0.58, span * 0.64], fov: 38 }}
        // in vista lista la scena resta montata (posizioni e post-it intatti) ma non viene disegnata
        frameloop={viewMode === 'office' ? 'always' : 'never'}
        style={{ display: viewMode === 'office' ? 'block' : 'none' }}
      >
        <color attach="background" args={['#eceef1']} />
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
          />
        ))}
        {model.boss && <Actor agent={model.boss} preset={BOSS_PRESET} target={model.targets[model.boss.id] ?? null} layout={layout} />}
        <OrbitControls makeDefault maxPolarAngle={Math.PI / 2.3} minDistance={5} maxDistance={span * 2} />
      </Canvas>
      {viewMode === 'list' && (
        <ListView sessions={fullSnapshot?.sessions ?? []} agents={fullSnapshot?.agents ?? []} hidden={hidden} onToggle={toggleSession} />
      )}
      <HudOverlay side="left">{viewMode === 'office' && <SessionPanel session={model.session} />}</HudOverlay>
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
function Actor({ agent, preset, target, layout, card = null, onCard }: {
  agent: AgentState;
  preset: CharacterPreset;
  target: Seat | null;
  layout: ReturnType<typeof officeModel>['layout'];
  card?: TaskCard | null;
  onCard?: (id: string, place: CardPlace) => void;
}) {
  const move = useCallback((place: CardPlace) => onCard?.(agent.id, place), [onCard, agent.id]);
  return (
    <AgentActor layout={layout} target={target} card={card?.place ?? null} onCard={move}>
      {(motion) => {
        const atDesk = motion.seated && (motion.seatId === 'boss' || (motion.seatId?.startsWith('seat-') ?? false));
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
            <AgentLabel agent={agent} position={[0, 1.6, 0]} />
          </>
        );
      }}
    </AgentActor>
  );
}
