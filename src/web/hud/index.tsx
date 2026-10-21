import type { ReactNode } from 'react';
import type { AgentState, RepoState, SessionState } from '../../shared/types';

/** 1234 -> "1.2k", 2_500_000 -> "2.5M" */
export function formatTokens(_n: number): string {
  throw new Error('not implemented');
}

/** Pannello overlay: modello, effort, contesto (barra), token usati/rimanenti. */
export function SessionPanel(_props: { session: SessionState | null }): ReactNode {
  return null;
}

/** Pannello overlay: progetto, branch, +righe / -righe. */
export function RepoPanel(_props: { repo: RepoState | null }): ReactNode {
  return null;
}

/** Etichetta 3D sopra il personaggio (drei <Html>): nome, area colorata, barra % (o indeterminata), token. */
export function AgentLabel(_props: { agent: AgentState }): ReactNode {
  return null;
}
