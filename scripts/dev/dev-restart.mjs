// `npm run dev:restart`: ask the running `npm run dev` of this worktree to restart the app process only.
// Sends SIGUSR2 to the runner (pid in .dev/runner.pid); the runner SIGTERMs the app and starts a new one.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { devDir } from './env.mjs';

const pidFile = resolve(devDir, 'runner.pid');
const pid = existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8')) : 0;
try {
  if (!pid) throw new Error('no pid file');
  process.kill(pid, 'SIGUSR2');
  console.log(`restart requested (dev runner pid ${pid})`);
} catch {
  console.error('dev:restart: no running `npm run dev` found for this worktree.');
  process.exit(1);
}
