// Tiny process helpers shared by the wave scripts.
import { execFileSync, spawnSync } from 'node:child_process';

/** Run a command and return trimmed stdout; throws with stderr on failure. */
export function out(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

/** Run a command with the terminal attached; exits the script when it fails. */
export function run(cmd, args, opts = {}) {
  console.log(`$ ${[cmd, ...args].join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) fail(`${cmd} ${args[0] ?? ''} failed (exit ${r.status})`);
}

/** Like `out`, but returns null instead of throwing. */
export function tryOut(cmd, args, opts = {}) {
  try { return out(cmd, args, opts); } catch { return null; }
}

export function fail(msg) {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}
