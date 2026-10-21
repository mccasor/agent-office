import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';
import { main, type RunningOffice } from '../src/cli';

/**
 * Smoke visivo headless (#23): CLI su fixture -> pagina in Chromium (SwiftShader) -> etichette agente
 * visibili, canvas WebGL non vuoto, nessun errore JS. Richiede dist/web (npm run build).
 * Saltato se il Chromium di Playwright non è installato, salvo AGENT_OFFICE_VISUAL=1 (CI) che lo rende obbligatorio.
 */
const fixtures = fileURLToPath(new URL('./fixtures/transcript', import.meta.url));
const hasChromium = existsSync(chromium.executablePath());
if (!hasChromium && process.env.AGENT_OFFICE_VISUAL === '1') {
  throw new Error('AGENT_OFFICE_VISUAL=1 ma Chromium di Playwright non è installato (npx playwright install chromium)');
}

describe.skipIf(!hasChromium)('visual: scena 3D headless', () => {
  let office: RunningOffice;
  let browser: Browser;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'agent-office-visual-'));
    const claudeHome = join(dataDir, 'claude');
    // cpSync non preserva i timestamp: mtime = ora, quindi a0000000000000002 risulta attivo
    cpSync(fixtures, claudeHome, { recursive: true });
    process.env.CLAUDE_CONFIG_DIR = claudeHome;
    process.env.AGENT_OFFICE_DATA_DIR = join(dataDir, 'events');
    const res = await main(['--no-open', '--port', '0', '--cwd', '/tmp/agent-office-fixture']);
    if (!res) throw new Error('main non ha avviato il server');
    office = res;
    browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await office?.close();
    delete process.env.CLAUDE_CONFIG_DIR;
    delete process.env.AGENT_OFFICE_DATA_DIR;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('mostra etichette agente e un canvas non vuoto, senza errori', async () => {
    const page = await browser.newPage({ viewport: { width: 1024, height: 700 } });
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto(office.url);
    const label = page.locator('.hud-label').filter({ hasText: 'Build HUD panel' });
    await label.first().waitFor({ state: 'visible', timeout: 20_000 });
    expect(await page.locator('.hud-label').count()).toBeGreaterThanOrEqual(1);

    // qualche frame di render prima dello screenshot (CDP cattura anche il canvas WebGL)
    await page.waitForTimeout(1000);
    const png = (await page.locator('canvas').screenshot()).toString('base64');
    const distinctColors = await page.evaluate(async (data) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, c.width, c.height).data;
      const colors = new Set<number>();
      for (let i = 0; i < px.length && colors.size < 50; i += 4) colors.add((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
      return colors.size;
    }, png);
    // sfondo uniforme = 1 colore; la scena (pavimento, scrivanie, personaggi, ombre) ne produce molti
    expect(distinctColors).toBeGreaterThan(10);
    expect(errors).toEqual([]);
    await page.close();
  }, 60_000);
});
