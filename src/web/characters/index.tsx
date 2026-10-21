import type { ReactNode } from 'react';

export interface CharacterPreset {
  id: string;
  skin: string;
  hair: string;
  hairStyle: 'short' | 'long' | 'bun' | 'bald' | 'cap';
  shirt: string;
  pants: string;
  accessory: 'none' | 'glasses' | 'headphones' | 'tie';
}

export declare const CHARACTER_PRESETS: readonly CharacterPreset[];

/** Deterministico: stesso agentId -> stesso personaggio. */
export function pickPreset(_agentId: string): CharacterPreset {
  throw new Error('not implemented');
}

/** Personaggio low-poly procedurale (solo primitive three.js), animato via useFrame. */
export function Character(_props: { preset: CharacterPreset; walking: boolean; seated: boolean }): ReactNode {
  return null;
}
