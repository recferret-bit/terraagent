import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { RunJob, RunMessage } from './experiment-worker';

const SWC_LOADER = '@swc-node/register/esm-register';

/** A started run: its result promise and a way to stop it (timeout / cancel). */
export interface RunningJob {
  readonly result: Promise<RunMessage | 'terminated'>;
  terminate(): void;
}

/** Spawns the run in a `worker_thread` (same loader setup as the sim thread pool); never runs experiment code on the app thread. */
export function startRun(job: RunJob): RunningJob {
  process.env.SWC_NODE_PROJECT ??= resolve(import.meta.dirname, '../../../../../shared/tsconfig.base.json');
  const execArgv = process.execArgv.some((a) => a.includes(SWC_LOADER)) ? undefined : [...process.execArgv, '--import', SWC_LOADER];
  const worker = new Worker(new URL('./experiment-worker.ts', import.meta.url), { workerData: job, ...(execArgv ? { execArgv } : {}) });
  let stopped = false;
  const result = new Promise<RunMessage | 'terminated'>((done) => {
    let msg: RunMessage | undefined;
    worker.once('message', (m: RunMessage) => { msg = m; });
    worker.once('error', (e: Error) => done({ ok: false, error: e.message }));
    worker.once('exit', () => done(stopped ? 'terminated' : (msg ?? { ok: false, error: 'run thread exited without a result' })));
  });
  return { result, terminate: () => { stopped = true; void worker.terminate(); } };
}
