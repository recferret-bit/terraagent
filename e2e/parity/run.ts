// `npm run test:parity`: every case of the engine parity list (scenarios/parity/*.parity.ts) runs on the server host (the sim
// thread, Node) and on the local host (the browser engine, headless Chrome); the final snapshots must be equal (D-31).
// E2E_REUSE=1: use the Vite dev server already running on the client port instead of starting one.
import { chromium } from '@playwright/test';
import { listParityCases } from '@terra/scenarios/parity';
import { compareSnapshots } from '@terra/scenarios/parity/compare';
import { createServer } from 'vite';
import { urls } from '../harness/ports';
import { runServerParity } from './server';

const b64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64'));

interface LocalRun { tick: number; snapshotB64: string; outcomes: Record<string, string> }

function sameOutcomes(a: Record<string, string>, b: Record<string, string>): string[] {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return keys.filter((k) => a[k] !== b[k]).map((k) => `command ${k}: server ${a[k] ?? 'no answer'} != local ${b[k] ?? 'no answer'}`);
}

async function main(): Promise<number> {
  const u = urls();
  const only = process.argv.slice(2);
  const cases = listParityCases().filter((c) => only.length === 0 || only.includes(c.id));
  if (cases.length === 0) throw new Error(`no parity case matches ${only.join(', ')}`);

  // Vite on base + 1175 (clear of the dev stack's 1173 and the e2e stack's 1174) unless reusing the dev client; no app needed.
  const port = u.reuse ? u.clientPort : u.base + 1175;
  const vite = u.reuse ? null : await createServer({ configFile: 'vite.config.ts', server: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'warn' });
  await vite?.listen();
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ headless: true, ...(process.env.CI ? {} : { channel: 'chrome' }) });
  let failed = 0;
  try {
    const page = await browser.newPage();
    const errs: string[] = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`${base}/dev/parity/index.html`);
    await page.waitForFunction(() => '__parity' in window, undefined, { timeout: 60_000 });
    for (const c of cases) {
      const t0 = Date.now();
      const [server, local] = await Promise.all([
        runServerParity(c),
        page.evaluate((id) => (window as unknown as { __parity: { run(id: string): Promise<LocalRun> } }).__parity.run(id), c.id),
      ]);
      const r = compareSnapshots(server.snapshot, b64(local.snapshotB64));
      const outcomes = sameOutcomes(server.outcomes, local.outcomes);
      const diffs = [...r.diffs, ...outcomes, ...(server.tick === local.tick ? [] : [`final tick: server ${server.tick} != local ${local.tick}`]), ...errs];
      const ok = r.ok && diffs.length === 0;
      console.log(`${c.id}: ${c.ticks} ticks, ${r.entities} entities, ${Object.keys(server.outcomes).length} commands, max |Δpos| = ${r.maxPosDelta.toFixed(4)} tile, server host (sim thread) vs local host (headless Chrome) ${ok ? 'PASS' : 'FAIL'} (${Date.now() - t0} ms)`);
      if (!ok) { failed++; for (const d of diffs) console.log(`  - ${d}`); }
    }
  } finally {
    await browser.close();
    await vite?.close();
  }
  console.log(failed ? `parity: ${failed} of ${cases.length} case(s) FAILED` : `parity: ${cases.length} case(s) passed on both hosts`);
  return failed ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
