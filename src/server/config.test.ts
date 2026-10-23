import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, loadConfig } from './config.js';

describe('loadConfig', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agent-office-config-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('file assente o non valido: valori predefiniti', async () => {
    expect(await loadConfig(dir)).toEqual(DEFAULT_CONFIG);
    await writeFile(join(dir, 'config.json'), '{ rotto');
    expect(await loadConfig(dir)).toEqual(DEFAULT_CONFIG);
  });

  it('legge la finestra di attività e ignora valori fuori misura e chiavi dell\'app', async () => {
    await writeFile(join(dir, 'config.json'), JSON.stringify({ activeWindowMinutes: 30, notifyWaiting: false }));
    expect(await loadConfig(dir)).toEqual({ ...DEFAULT_CONFIG, activeWindowMinutes: 30 });
    await writeFile(join(dir, 'config.json'), JSON.stringify({ activeWindowMinutes: 0 }));
    expect(await loadConfig(dir)).toEqual(DEFAULT_CONFIG);
  });

  it('soglie degli avvisi sugli agenti (#97): fermo e in loop', async () => {
    await writeFile(join(dir, 'config.json'), JSON.stringify({ staleAgentMinutes: 90, loopRepeats: 8 }));
    expect(await loadConfig(dir)).toEqual({ ...DEFAULT_CONFIG, staleAgentMinutes: 90, loopRepeats: 8 });
    await writeFile(join(dir, 'config.json'), JSON.stringify({ staleAgentMinutes: -1, loopRepeats: 2.5 }));
    expect(await loadConfig(dir)).toEqual(DEFAULT_CONFIG);
  });
});
