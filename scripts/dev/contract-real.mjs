// `npm run contract:real -- --port ChainRead [--network testnet|mainnet]`: runs one port's contract suite against the REAL adapter.
// Selects it through NEAR_ADAPTER_<PORT> (same rule as the app). A port with no real adapter registered fails loudly.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const port = opt('port');
const network = opt('network') ?? 'testnet';
const fail = (msg) => { console.error(`contract:real: ${msg}`); process.exit(2); };

if (!port || !/^[A-Z][A-Za-z]+$/.test(port)) fail('usage: npm run contract:real -- --port <PortName> [--network testnet|mainnet]   e.g. --port ChainRead');
if (network !== 'testnet' && network !== 'mainnet') fail(`--network must be testnet or mainnet, got "${network}"`);

const key = `NEAR_ADAPTER_${port.replace(/([a-z\d])([A-Z])/g, '$1_$2').toUpperCase()}`;
const root = fileURLToPath(new URL('../../', import.meta.url));
const run = spawnSync(`${root}node_modules/.bin/vitest`, ['run', '--config', 'vitest.contract.config.ts'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, [key]: network, CONTRACT_PORT: port },
});
process.exit(run.status ?? 1);
