#!/usr/bin/env node
// `deploy` and `deploy:<stack>` (DEPLOYMENT §6). --dry-run prints the plan and does not connect.
import { loadEnv, root } from '../dev/env.mjs';
import { STACKS, loadCatalog, validateDeployEnv } from '../../infra/hosts/load-catalog.mjs';
import { buildPlan } from './deploy-plan.mjs';

async function main() {
  const { dryRun, stacks } = parseArgs(process.argv.slice(2));
  const env = deployEnv();
  const steps = buildPlan({ env, stacks, catalog: loadCatalog(), root });
  if (dryRun) {
    for (const step of steps) console.log(step.line);
    return;
  }
  const { executePlan } = await import('./remote.mjs');
  executePlan(steps, root);
}

function parseArgs(argv) {
  let dryRun = false;
  const chosen = [];
  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true;
    else if (STACKS.includes(arg)) chosen.push(arg);
    else fail(`deploy: unknown argument ${arg}`);
  }
  if (chosen.length > 1) fail(`deploy: pass one stack or none, not ${chosen.join(', ')}`);
  return { dryRun, stacks: chosen.length === 1 ? chosen : [...STACKS] };
}

function deployEnv() {
  try {
    return validateDeployEnv(loadEnv().env);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
