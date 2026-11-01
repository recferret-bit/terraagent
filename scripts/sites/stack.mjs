#!/usr/bin/env node
// Local site stack (DEPLOYMENT §5). npm script names are added by W26-09.
import { loadEnv } from '../dev/env.mjs';
import { downAll, upAll, upOne } from './compose.mjs';
import { smoke } from './smoke.mjs';

const STACKS = ['infra', 'frontend', 'backend', 'chain'];
const usage = 'usage: node scripts/sites/stack.mjs [up|infra|frontend|backend|chain|down|smoke]';

function main() {
  const cmd = process.argv[2] ?? 'up';
  if (process.argv.length > 3 || !['up', 'down', 'smoke', ...STACKS].includes(cmd)) {
    console.error(usage);
    process.exit(1);
  }
  const { env } = loadEnv();
  if (cmd === 'down') return downAll(env);
  if (cmd === 'smoke') return smoke(env);
  if (cmd === 'up') return upAll(env);
  return upOne(cmd, env);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
