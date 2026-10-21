export interface CharacterPreset {
  id: string;
  /** incarnato "clay": naso, labbra e palpebre inferiori ne derivano una tinta più calda */
  skin: string;
  hair: string;
  hairStyle: 'short' | 'long' | 'bun' | 'bald' | 'cap';
  /** barba piena che copre la metà inferiore della testa (colore), null = senza barba */
  beard: string | null;
  shirt: string;
  pants: string;
  accessory: 'none' | 'glasses' | 'headphones' | 'tie';
}

/** Palette da giocattolo in plastilina: incarnati caldi e saturi, capi opachi in toni pastello con pochi accenti. */
export const CHARACTER_PRESETS: readonly CharacterPreset[] = [
  { id: 'ada', skin: '#f7b9a4', hair: '#3b2a20', hairStyle: 'bun', beard: null, shirt: '#5b8bc4', pants: '#2f3542', accessory: 'glasses' },
  { id: 'bruno', skin: '#d99a72', hair: '#2a1d1a', hairStyle: 'short', beard: '#3a2230', shirt: '#e8826a', pants: '#3d405b', accessory: 'none' },
  { id: 'chiara', skin: '#fbc7b4', hair: '#e0ad4a', hairStyle: 'long', beard: null, shirt: '#86c2a3', pants: '#4a4e69', accessory: 'headphones' },
  { id: 'dario', skin: '#9a6247', hair: '#1a1416', hairStyle: 'bald', beard: '#2b1b24', shirt: '#f2cc8f', pants: '#264653', accessory: 'tie' },
  { id: 'elena', skin: '#f0b08f', hair: '#9a3e2e', hairStyle: 'long', beard: null, shirt: '#7d6493', pants: '#2b2d42', accessory: 'glasses' },
  { id: 'fabio', skin: '#f59a90', hair: '#6b4f3a', hairStyle: 'cap', beard: '#5a2a44', shirt: '#2fa596', pants: '#3a3a3a', accessory: 'headphones' },
  { id: 'giulia', skin: '#6e4232', hair: '#151012', hairStyle: 'bun', beard: null, shirt: '#ecc45e', pants: '#344e41', accessory: 'none' },
  { id: 'hugo', skin: '#f29a8c', hair: '#b4b0b4', hairStyle: 'short', beard: '#c9c3c9', shirt: '#5f82a3', pants: '#22333b', accessory: 'tie' },
  { id: 'irene', skin: '#fcd0bf', hair: '#c05a33', hairStyle: 'short', beard: null, shirt: '#c06c80', pants: '#355070', accessory: 'glasses' },
  { id: 'kofi', skin: '#7e4b36', hair: '#1b1b1b', hairStyle: 'cap', beard: '#1f1418', shirt: '#f4a261', pants: '#2f3e46', accessory: 'none' },
  { id: 'luna', skin: '#f3bea0', hair: '#34346a', hairStyle: 'long', beard: null, shirt: '#97c46f', pants: '#43454f', accessory: 'headphones' },
  { id: 'marco', skin: '#f48e86', hair: '#4a1f33', hairStyle: 'bald', beard: '#4a1f33', shirt: '#4bb08f', pants: '#1d3557', accessory: 'glasses' },
  { id: 'nadia', skin: '#b67a55', hair: '#2a1a12', hairStyle: 'bun', beard: null, shirt: '#f28482', pants: '#3c3c58', accessory: 'tie' },
  { id: 'otto', skin: '#f7c2a2', hair: '#e3c16f', hairStyle: 'short', beard: '#c99a4a', shirt: '#6a7182', pants: '#283044', accessory: 'headphones' },
];

/** Claudio Code, il boss: testa rosa con barba prugna come il riferimento, camicia arancio Claude e cravatta. Fuori dalla rotazione di pickPreset. */
export const BOSS_PRESET: CharacterPreset = {
  id: 'claudio', skin: '#f58f8c', hair: '#4a1a33', hairStyle: 'bald', beard: '#4a1a33', shirt: '#d97757', pants: '#2b2d42', accessory: 'tie',
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
