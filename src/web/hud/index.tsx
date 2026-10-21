import { useState } from 'react';
import { Html } from '@react-three/drei';
import type { AgentState } from '../../shared/types';
import { AgentLabelContent } from './AgentLabelContent';

export { formatTokens, percent, contextLevel } from './format';
export type { ContextLevel } from './format';
export { SessionPanel, RepoPanel, HudOverlay } from './panels';
export { AgentLabelContent } from './AgentLabelContent';
export { ProgressBar } from './ProgressBar';
export { TokenBreakdown } from './TokenBreakdown';

export interface AgentLabelProps {
  agent: AgentState;
  /** posizione locale rispetto al personaggio (default: sopra la testa) */
  position?: [number, number, number];
  /** scala dell'Html in funzione della distanza dalla camera */
  distanceFactor?: number;
  /** hover deciso dalla scena (in aggiunta all'hitbox interna attorno al personaggio) */
  hovered?: boolean;
}

/** Hitbox invisibile attorno al personaggio (coordinate locali dell'attore). */
const HIT_SIZE: [number, number, number] = [0.8, 1.5, 0.8];

/**
 * Etichetta 3D sopra il personaggio (drei <Html>): compatta (nome + barra), dettaglio
 * (area, token con ripartizione, stato) al passaggio del mouse su personaggio o etichetta.
 */
export function AgentLabel({ agent, position = [0, 2.2, 0], distanceFactor = 10, hovered = false }: AgentLabelProps) {
  const [overActor, setOverActor] = useState(false);
  const [overLabel, setOverLabel] = useState(false);
  const expanded = hovered || overActor || overLabel;
  return (
    <>
      <mesh
        position={[0, HIT_SIZE[1] / 2, 0]}
        onPointerOver={(e) => {
          e.stopPropagation();
          setOverActor(true);
        }}
        onPointerOut={() => setOverActor(false)}
      >
        <boxGeometry args={HIT_SIZE} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <Html
        center
        distanceFactor={distanceFactor}
        position={position}
        pointerEvents="auto"
        zIndexRange={expanded ? [100, 50] : [10, 0]}
      >
        <AgentLabelContent agent={agent} expanded={expanded} onHoverChange={setOverLabel} />
      </Html>
    </>
  );
}
