import { Html } from '@react-three/drei';
import type { AgentState } from '../../shared/types';
import { AgentLabelContent, type Waiting } from './AgentLabelContent';

export { formatTokens, formatDuration, percent, contextLevel } from './format';
export type { ContextLevel } from './format';
export { RepoPanel, HudOverlay } from './panels';
export { InstancesPanel } from './InstancesPanel';
export { AgentCard } from './AgentCard';
export { AgentLabelContent, activityText } from './AgentLabelContent';
export type { Waiting } from './AgentLabelContent';
export { ProgressBar } from './ProgressBar';
export { ListView, ViewToggle } from './ListView';
export { TokenBreakdown } from './TokenBreakdown';

export interface AgentLabelProps {
  agent: AgentState;
  /** posizione locale rispetto al personaggio (default: sopra la testa) */
  position?: [number, number, number];
  /** scala dell'Html in funzione della distanza dalla camera */
  distanceFactor?: number;
  /** sessione bloccata in attesa dell'utente */
  waiting?: Waiting | null;
  /** la sua scheda è aperta */
  selected?: boolean;
  /** clic sul personaggio o sull'etichetta: apre la scheda */
  onSelect?: (agentId: string) => void;
}

/** Hitbox invisibile attorno al personaggio (coordinate locali dell'attore). */
const HIT_SIZE: [number, number, number] = [0.8, 1.5, 0.8];

/**
 * Etichetta 3D sopra il personaggio (drei <Html>), sempre compatta (nome + barra): il clic su personaggio
 * o etichetta apre la scheda dell'agente.
 */
export function AgentLabel({ agent, position = [0, 2.2, 0], distanceFactor = 10, waiting = null, selected = false, onSelect }: AgentLabelProps) {
  const pointer = (on: boolean) => {
    if (onSelect) document.body.style.cursor = on ? 'pointer' : '';
  };
  return (
    <>
      <mesh
        position={[0, HIT_SIZE[1] / 2, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect?.(agent.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          pointer(true);
        }}
        onPointerOut={() => pointer(false)}
      >
        <boxGeometry args={HIT_SIZE} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <Html
        center
        distanceFactor={distanceFactor}
        position={position}
        pointerEvents="auto"
        zIndexRange={selected || waiting ? [100, 50] : [10, 0]}
      >
        <AgentLabelContent agent={agent} waiting={waiting} selected={selected} onSelect={onSelect} />
      </Html>
    </>
  );
}
