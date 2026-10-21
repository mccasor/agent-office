export interface CharacterPreset {
  id: string;
  skin: string;
  hair: string;
  hairStyle: 'short' | 'long' | 'bun' | 'bald' | 'cap';
  shirt: string;
  pants: string;
  accessory: 'none' | 'glasses' | 'headphones' | 'tie';
}

/** Palette: incarnati realistici, capi in toni desaturati coordinati con pochi accenti. */
export const CHARACTER_PRESETS: readonly CharacterPreset[] = [
  { id: 'ada', skin: '#f2d0b1', hair: '#3b2a20', hairStyle: 'bun', shirt: '#4f7cac', pants: '#2f3542', accessory: 'glasses' },
  { id: 'bruno', skin: '#c68c5d', hair: '#1f1a17', hairStyle: 'short', shirt: '#e07a5f', pants: '#3d405b', accessory: 'none' },
  { id: 'chiara', skin: '#f6dcc3', hair: '#d9a441', hairStyle: 'long', shirt: '#81b29a', pants: '#4a4e69', accessory: 'headphones' },
  { id: 'dario', skin: '#8d5a3b', hair: '#121212', hairStyle: 'bald', shirt: '#f2cc8f', pants: '#264653', accessory: 'tie' },
  { id: 'elena', skin: '#e8b98f', hair: '#8c3b2e', hairStyle: 'long', shirt: '#6d597a', pants: '#2b2d42', accessory: 'glasses' },
  { id: 'fabio', skin: '#f1c9a5', hair: '#6b4f3a', hairStyle: 'cap', shirt: '#2a9d8f', pants: '#3a3a3a', accessory: 'headphones' },
  { id: 'giulia', skin: '#5c3a26', hair: '#0f0c0b', hairStyle: 'bun', shirt: '#e9c46a', pants: '#344e41', accessory: 'none' },
  { id: 'hugo', skin: '#d9a77c', hair: '#9a9a9a', hairStyle: 'short', shirt: '#577590', pants: '#22333b', accessory: 'tie' },
  { id: 'irene', skin: '#f5d5be', hair: '#b5562f', hairStyle: 'short', shirt: '#b56576', pants: '#355070', accessory: 'glasses' },
  { id: 'kofi', skin: '#6f4430', hair: '#1b1b1b', hairStyle: 'cap', shirt: '#f4a261', pants: '#2f3e46', accessory: 'none' },
  { id: 'luna', skin: '#eac4a0', hair: '#2c2c54', hairStyle: 'long', shirt: '#90be6d', pants: '#43454f', accessory: 'headphones' },
  { id: 'marco', skin: '#b97a50', hair: '#4a3020', hairStyle: 'bald', shirt: '#43aa8b', pants: '#1d3557', accessory: 'glasses' },
  { id: 'nadia', skin: '#a8714a', hair: '#2a1a12', hairStyle: 'bun', shirt: '#f28482', pants: '#3c3c58', accessory: 'tie' },
  { id: 'otto', skin: '#f0cfae', hair: '#e3c16f', hairStyle: 'short', shirt: '#5e6472', pants: '#283044', accessory: 'headphones' },
];

/** Claudio Code, il boss: camicia arancio Claude e cravatta. Fuori dalla rotazione di pickPreset. */
export const BOSS_PRESET: CharacterPreset = {
  id: 'claudio', skin: '#f1c9a5', hair: '#5a3d2b', hairStyle: 'short', shirt: '#d97757', pants: '#2b2d42', accessory: 'tie',
};

/** FNV-1a 32 bit + finalizzatore murmur3 (miglior dispersione su id simili). */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Deterministico: stesso agentId -> stesso personaggio. */
export function pickPreset(agentId: string): CharacterPreset {
  return CHARACTER_PRESETS[hashString(agentId) % CHARACTER_PRESETS.length]!;
}
