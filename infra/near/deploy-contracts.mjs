#!/usr/bin/env node
/**
 * Builds and deploys all 6 TerraAgent Rust NEAR smart contracts (`res`, `deed`, `bounty`, `staking`, `dao`, `pilots`)
 * and provisions `relayer.<root>`, `minter.<root>`, and `protocol.<root>` sub-accounts on NEAR Testnet/Mainnet.
 *
 * Usage:
 *   node infra/near/deploy-contracts.mjs [all|res|deed|bounty|staking|dao|pilots] [--redeploy] [--dry-run] [--network testnet|mainnet]
 *
 * Delegates deployment to `scripts/dev/deploy-testnet-contracts.mjs` after compiling WASM artifacts.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const VALID_CONTRACTS = new Set(['res', 'deed', 'bounty', 'staking', 'dao', 'pilots']);

function translateArgs(argv) {
  const passthrough = [];
  let skipBuild = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === 'all') {
      passthrough.push('--ensure-accounts');
    } else if (arg === '--no-build') {
      skipBuild = true;
    } else if (VALID_CONTRACTS.has(arg)) {
      passthrough.push('--only', arg);
    } else {
      passthrough.push(arg);
    }
  }
  return { passthrough, skipBuild };
}

function main() {
  const { passthrough, skipBuild } = translateArgs(process.argv.slice(2));
  if (!skipBuild) {
    const build = spawnSync(
      'cargo',
      ['build', '--manifest-path', 'backend/near-contracts/Cargo.toml', '--release', '--target', 'wasm32-unknown-unknown'],
      { cwd: REPO_ROOT, stdio: 'inherit' },
    );
    if (build.status !== 0) {
      process.exit(build.status ?? 1);
    }
  }

  const deploy = spawnSync(
    process.execPath,
    ['scripts/dev/deploy-testnet-contracts.mjs', ...passthrough],
    { cwd: REPO_ROOT, stdio: 'inherit', env: process.env },
  );
  process.exit(deploy.status ?? 0);
}

main();
