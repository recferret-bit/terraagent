import type { WorkerLike } from '../WorldStore';

let prewarmedWorker: WorkerLike | null = null;

/** Starts loading `sim.worker.ts` off-thread before Three.js viewport setup blocks the main thread. */
export function prewarmSimWorker(): void {
  if (prewarmedWorker || typeof Worker !== 'function') return;
  prewarmedWorker = new Worker(new URL('./sim.worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as WorkerLike;
}

export function takePrewarmedSimWorker(): WorkerLike | null {
  const worker = prewarmedWorker;
  prewarmedWorker = null;
  return worker;
}

export function disposePrewarmedSimWorker(): void {
  if (!prewarmedWorker) return;
  prewarmedWorker.terminate();
  prewarmedWorker = null;
}
