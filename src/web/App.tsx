import { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { AgentActor, Office } from './scene';
import { Character, pickPreset } from './characters';
import { AgentLabel, HudOverlay, RepoPanel, SessionPanel } from './hud';
import { connectSnapshotStream, useOfficeStore } from './store';
import { officeModel } from './officeModel';
import './app.css';

export function App() {
  const snapshot = useOfficeStore((s) => s.snapshot);
  const connected = useOfficeStore((s) => s.connected);
  // posti ricalcolati solo quando arriva un nuovo snapshot, partendo dai precedenti (posti stabili)
  const [view, setView] = useState(() => ({ snapshot, model: officeModel(snapshot, { seats: {}, capacity: 0 }) }));
  if (view.snapshot !== snapshot) setView({ snapshot, model: officeModel(snapshot, view.model) });
  const { model } = view;

  useEffect(() => connectSnapshotStream(), []);

  const { layout } = model;
  const span = Math.max(layout.width, layout.depth);

  return (
    <>
      <Canvas shadows camera={{ position: [0, span * 0.9, span * 0.75], fov: 45 }}>
        <color attach="background" args={['#dfe3e8']} />
        <Office layout={layout} />
        {model.agents.map((agent) => {
          const seatId = model.seats[agent.id];
          if (!seatId) return null;
          return (
            <AgentActor key={agent.id} agent={agent} layout={layout} seatId={seatId}>
              {(motion) => (
                <>
                  <Character preset={pickPreset(agent.id)} walking={motion.walking} seated={motion.seated} />
                  <AgentLabel agent={agent} position={[0, 1.6, 0]} />
                </>
              )}
            </AgentActor>
          );
        })}
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
