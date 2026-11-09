// `npm run economy -- <command> --json` (ECONOMY §6, W13-46): the noninteractive economy CLI over `/v1/economy/*`.
// Base URL: TA_ECONOMY_API, else the worktree app port from infra/.env.worktree (TA_PORT_BASE + 1), else 127.0.0.1:4001.
// Tokens: TA_ECONOMY_TOKEN (edit/run) and TA_ECONOMY_ACTIVATE_TOKEN (operator), dev defaults outside production.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { runCli } from './cli-lib';

const root = resolve(import.meta.dirname, '../..');
const worktree = (): Record<string, string> => {
  const f = resolve(root, 'infra/.env.worktree');
  return existsSync(f) ? (parseEnv(readFileSync(f, 'utf8')) as Record<string, string>) : {};
};

async function main(): Promise<void> {
  const env = { ...worktree(), ...process.env };
  const base = env.TA_ECONOMY_API ?? `http://127.0.0.1:${Number(env.PORT ?? Number(env.TA_PORT_BASE ?? 4000) + 1)}`;
  const res = await runCli(process.argv.slice(2), {
    base, editToken: env.TA_ECONOMY_TOKEN ?? 'dev-economy-operator', activateToken: env.TA_ECONOMY_ACTIVATE_TOKEN ?? 'dev-economy-activator', fetch,
  }, {
    readFile: (p) => readFileSync(p, 'utf8'), writeFile: (p, t) => writeFileSync(p, t), readStdin: () => readFileSync(0, 'utf8'),
  });
  process.stdout.write(`${JSON.stringify(res.out, null, 2)}\n`);
  if (res.diagnostics) process.stderr.write(`${res.diagnostics}\n`);
  process.exit(res.code);
}

void main();
