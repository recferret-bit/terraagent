// Child processes for the W26 site stack. TA_DB_NAME is terra_w26_e2e so compose and
// db:migrate do not touch the game e2e database. DATABASE_URL is dropped: an inherited
// URL would win over TA_DB_NAME.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

export const SITE_DB = 'terra_w26_e2e';

const ROOT = resolve(import.meta.dirname, '..');
const HEALTH_FORMAT = '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}';

export interface ProcResult {
  status: number;
  stdout: string;
  stderr: string;
}

export function siteEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, TA_DB_NAME: SITE_DB, ...extra };
  delete env.DATABASE_URL;
  return env;
}

export function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, capture: boolean): ProcResult {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) throw result.error;
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

export function npm(args: string[], extra: Record<string, string> = {}, capture = false): ProcResult {
  return run('npm', args, siteEnv(extra), capture);
}

export function docker(args: string[]): ProcResult {
  return run('docker', args, siteEnv(), true);
}

/** `running healthy`, `running none`, or null when the container does not exist. */
export function healthOf(name: string): string | null {
  const result = docker(['inspect', '--format', HEALTH_FORMAT, name]);
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

export function waitHealthy(name: string, seconds = 180): void {
  const deadline = Date.now() + seconds * 1000;
  let last = 'missing';
  while (Date.now() < deadline) {
    last = healthOf(name) ?? 'missing';
    if (last === 'running healthy') return;
    spawnSync('sleep', ['2']);
  }
  throw new Error(`${name} did not become healthy (${last})`);
}
