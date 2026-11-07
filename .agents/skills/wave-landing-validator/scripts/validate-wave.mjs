#!/usr/bin/env node
// CLI entrypoint for `.agents/skills/wave-landing-validator` (`npm run validate:wave -- [NN] [options]`).
// Defaults to `--check-only` (static AST, duplication, orchestrator/service split, client+server wiring & wave task parity).
// Pass `--gates` to also run `ci:fast` (+ 3D validators), `--e2e` for wave E2E, `--print-prompt` for the 2-iteration prompt,
// or `--launch` to invoke the wave's AI runner for the 2-iteration review-and-fix loop.
import { mainRoot, loadPlan, withState, currentWave } from '../../../../scripts/wave/plan.mjs';
import { validateWaveCli } from '../../../../scripts/wave/validate.mjs';
import { fail } from '../../../../scripts/wave/sh.mjs';

const args = process.argv.slice(2);
const VALUE_OPTS = ['--tags', '--parallel', '--runner', '--model', '--advisor', '--mode', '--effort', '--root', '--rounds'];
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const positional = args.filter((a, i) => !a.startsWith('--') && !VALUE_OPTS.includes(args[i - 1]));

const root = mainRoot();
const plan = withState(root, loadPlan(root));
const byId = (n) => plan.waves.find((w) => w.id === `W${String(n).replace(/^w/i, '').padStart(2, '0')}`) ?? fail(`unknown wave ${n}`);

const waveArg = positional[0];
const target = waveArg
  ? byId(waveArg)
  : currentWave(plan) ?? plan.waves.find((w) => w.open) ?? plan.waves[0];

const code = validateWaveCli(root, target, {
  overrides: {
    runner: opt('--runner', null),
    model: opt('--model', null),
    advisor: opt('--advisor', null),
    mode: opt('--mode', null),
    effort: opt('--effort', null),
    parallel: opt('--parallel', null),
    tags: opt('--tags', null)?.split(',') ?? null,
  },
  dryRun: flag('--dry-run'),
  checkOnly: !flag('--launch'),
  printPrompt: flag('--print-prompt'),
  noLaunch: flag('--no-launch'),
  gates: flag('--gates'),
  e2e: flag('--e2e') && !flag('--no-e2e'),
  strict: flag('--strict'),
  json: flag('--json'),
  quiet: flag('--quiet'),
  rounds: Number(opt('--rounds', 1)),
});

if (code !== 0) process.exit(code);
