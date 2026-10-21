import { Html } from '@react-three/drei';
import type { AgentState } from '../../shared/types';
import { AgentLabelContent } from './AgentLabelContent';

export { formatTokens, percent, contextLevel } from './format';
export type { ContextLevel } from './format';
export { SessionPanel, RepoPanel, HudOverlay } from './panels';
export { AgentLabelContent } from './AgentLabelContent';
export { ProgressBar } from './ProgressBar';

export interface AgentLabelProps {
  agent: AgentState;
  /** posizione locale rispetto al personaggio (default: sopra la testa) */
  position?: [number, number, number];
  /** scala dell'Html in funzione della distanza dalla camera */
  distanceFactor?: number;
}

/** Etichetta 3D sopra il personaggio (drei <Html>): nome, area colorata, barra % (o indeterminata), token. */
export function AgentLabel({ agent, position = [0, 2.2, 0], distanceFactor = 10 }: AgentLabelProps) {
  return (
    <Html center distanceFactor={distanceFactor} position={position} pointerEvents="none" zIndexRange={[10, 0]}>
      <AgentLabelContent agent={agent} />
    </Html>
  );
}
