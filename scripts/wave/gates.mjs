// Gates a branch must pass before it merges: `npm run ci:fast` (+ the wave e2e with `--hack` for issues and checks).
import { spawnSync } from 'node:child_process';
import { fail } from './sh.mjs';

const pad = (n) => String(n).padStart(2, '0');

/** `TA_WAVE_GATES` (a shell command) replaces the real gates: used by the sandbox tests. */
export function runGates(cwd, { waveNumber = null, e2e = true, dryRun = false } = {}) {
  const steps = [['npm', ['run', 'ci:fast']]];
  if (e2e && waveNumber != null) steps.push(['npm', ['run', 'e2e', '--', '--waves', `..${pad(waveNumber)}`, '--hack']]);
  if (dryRun) return console.log(`would run gates in ${cwd}: ${steps.map(([c, a]) => `${c} ${a.join(' ')}`).join(' && ')}`);
  for (const [cmd, args] of process.env.TA_WAVE_GATES ? [['sh', ['-c', process.env.TA_WAVE_GATES]]] : steps) {
    console.log(`$ ${[cmd, ...args].join(' ')}`);
    const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
    if (r.status !== 0) fail(`gate failed in ${cwd}: ${cmd} ${args.join(' ')} (exit ${r.status})`);
  }
}
