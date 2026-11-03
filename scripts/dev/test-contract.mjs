// `npm run test:contract [-- --port identity,relayer]`: vitest rejects `--port`, so this parses it into `CONTRACT_PORT`.
// A comma list, any case. An empty `--port` runs every suite. Other arguments are forwarded to vitest.
// `npm run contract:real` does not use this script; it sets `CONTRACT_PORT` itself and spawns the same config.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
let port;
const rest = [];
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--port') {
    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) port = '';
    else { port = next; i += 1; }
    continue;
  }
  if (arg.startsWith('--port=')) { port = arg.slice('--port='.length); continue; }
  rest.push(arg);
}

const root = fileURLToPath(new URL('../../', import.meta.url));
const env = { ...process.env };
if (port !== undefined) {
  if (port.trim() === '') delete env.CONTRACT_PORT;
  else env.CONTRACT_PORT = port;
}
const run = spawnSync(root + 'node_modules/.bin/vitest', ['run', '--config', 'tests/vitest.contract.config.ts', ...rest], {
  cwd: root, stdio: 'inherit', env,
});
process.exit(run.status ?? 1);
