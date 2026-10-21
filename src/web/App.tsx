import { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { AgentState } from '../shared/types';
import { AgentActor, DESK_CUP, Office, type Seat } from './scene';
import { BOSS_PRESET, Character, CoffeeCup, pickPreset, type CharacterPreset } from './characters';
import { AgentLabel, HudOverlay, RepoPanel, SessionPanel } from './hud';
import { connectSnapshotStream, useOfficeStore } from './store';
import { officeModel } from './officeModel';
import './app.css';

export function App() {
  const snapshot = useOfficeStore((s) => s.snapshot);
  const connected = useOfficeStore((s) => s.connected);
  // posti ricalcolati solo quando arriva un nuovo snapshot, partendo dai precedenti (posti stabili)
  const [view, setView] = useState(() => ({ snapshot, model: officeModel(snapshot, { seats: {}, lounge: {}, capacity: 0 }) }));
  if (view.snapshot !== snapshot) setView({ snapshot, model: officeModel(snapshot, view.model) });
  const { model } = view;

  useEffect(() => connectSnapshotStream(), []);

  const { layout } = model;
  const span = Math.max(layout.width, layout.depth);

  return (
    <>
      {/* vista a 3/4 dall'angolo sud-est, come uno spaccato isometrico: pareti di fondo nord e ovest */}
      <Canvas shadows camera={{ position: [span * 0.5, span * 0.58, span * 0.64], fov: 38 }}>
        <color attach="background" args={['#eceef1']} />
        <Office layout={layout} />
        {model.agents.map((agent) => (
          <Actor key={agent.id} agent={agent} preset={pickPreset(agent.id)} target={model.targets[agent.id] ?? null} layout={layout} />
        ))}
        {model.boss && <Actor agent={model.boss} preset={BOSS_PRESET} target={model.targets[model.boss.id] ?? null} layout={layout} />}
        <OrbitControls makeDefault maxPolarAngle={Math.PI / 2.3} minDistance={5} maxDistance={span * 2} />
      </Canvas>
      <HudOverlay side="left">
        <SessionPanel session={model.session} />
      </HudOverlay>
      <HudOverlay side="right">
        <RepoPanel repo={snapshot?.repo ?? null} />
        {!connected && <div className="hud-panel app-offline">Disconnesso: riconnessione…</div>}
      </HudOverlay>
    </>
  );
}

/**
 * Un agente (o Claudio Code) in scena: entra con la tazza di caffè fumante, la posa sulla scrivania quando si siede
 * e la riprende quando si alza; sui divani dell'area relax la tiene in mano.
 */
function Actor({ agent, preset, target, layout }: {
  agent: AgentState;
  preset: CharacterPreset;
  target: Seat | null;
  layout: ReturnType<typeof officeModel>['layout'];
}) {
  return (
    <AgentActor layout={layout} target={target}>
      {(motion) => {
        const atDesk = motion.seated && motion.seatId !== null && !motion.seatId.startsWith('lounge-');
        return (
          <>
            <Character preset={preset} walking={motion.walking} seated={motion.seated} holding={!atDesk} typing={atDesk} />
            {atDesk && <CoffeeCup position={DESK_CUP} />}
            <AgentLabel agent={agent} position={[0, 1.6, 0]} />
          </>
        );
      }}
    </AgentActor>
  );
}
