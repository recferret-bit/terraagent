// `npm run e2e -- [--waves ..NN|00,03] [--hack] [--host local] [playwright args…]`
// Runs the Playwright suites e2e/wNN.spec.ts (+ the harness smoke suite when no wave suite is present).
// --waves  which wave suites (parseWaves semantics: `..03`, `00,03`, `all`); default: every suite present
// --hack   only steps titled `@hack` (each wave's Hackathon slice)
// --host local   sets E2E_HOST=local: suites run the sim-only variant (browser local host) and skip server-only steps
// E2E_REUSE=1    attach to the running `npm run dev` stack instead of booting one
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from './env.mjs';


function selectWaves(spec, present) {
  const s = (spec ?? '').trim();
  if (s === '' || s === 'all') return present;
  const up = /^\.\.W?(\d{1,2})$/i.exec(s);
  if (up) return present.filter((n) => n <= Number(up[1]));
  const set = new Set(s.split(',').map((p) => {
    const m = /^W?(\d{1,2})$/i.exec(p.trim());
    if (!m) { console.error(`e2e: --waves "${s}": "${p}" is not a wave number`); process.exit(2); }
    return Number(m[1]);
  }));
  return present.filter((n) => set.has(n));
}

const argv = process.argv.slice(2);
let waves, hack = false, host = 'server';
const rest = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--waves') waves = argv[++i];
  else if (a.startsWith('--waves=')) waves = a.slice(8);
  else if (a === '--hack') hack = true;
  else if (a === '--host') host = argv[++i];
  else if (a.startsWith('--host=')) host = a.slice(7);
  else rest.push(a);
}
if (!['server', 'local'].includes(host)) { console.error(`e2e: --host must be "local" or "server" (got "${host}")`); process.exit(2); }

const present = readdirSync(resolve(root, 'e2e')).map((f) => /^w(\d\d)\.spec\.ts$/.exec(f)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b);
const files = selectWaves(waves, present).map((n) => `e2e/w${String(n).padStart(2, '0')}.spec.ts`);
if (present.length === 0) files.push('e2e/harness/smoke.spec.ts'); // before the first wave suite exists
else if (files.length === 0) { console.error(`e2e: no suite matches --waves ${waves} (present: ${present.map((n) => `w${String(n).padStart(2, '0')}`).join(', ')})`); process.exit(2); }

const args = ['playwright', 'test', '-c', 'e2e/playwright.config.ts', ...files, ...(hack ? ['--grep', '@hack'] : []), ...rest];
console.log(`e2e: ${files.join(' ')}${hack ? '  (@hack only)' : ''}  host=${host}`);
const r = spawnSync('npx', args, { cwd: root, stdio: 'inherit', env: { ...process.env, E2E_HOST: host, E2E_WAVES: waves ?? '', E2E_HACK: hack ? '1' : '' } });
process.exit(r.status ?? 1);
