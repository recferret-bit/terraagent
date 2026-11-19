/**
 * Frame-sliced GPU/CPU resource disposer.
 * Destroying dozens of WebGL geometries, textures, and shader programs in a single synchronous `dispose()` call
 * during stage cuts (`OrbitalStage -> DescentRunner -> OnlineSession`) stalls the main thread and GPU command queue.
 * Enqueued tasks drain incrementally within a small per-frame millisecond budget (`stepDeferredDispose`), or
 * immediately on full teardown (`flushDeferredDispose`).
 */

type DisposeTask = () => void;

const queue: DisposeTask[] = [];
let scheduledRaf = 0;
let lastStepAtMs = -100;

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function scheduleDrain(): void {
  if (scheduledRaf !== 0 || queue.length === 0) return;
  if (typeof requestAnimationFrame === 'function') {
    scheduledRaf = requestAnimationFrame(() => {
      scheduledRaf = 0;
      if (nowMs() - lastStepAtMs >= 6) {
        stepDeferredDispose(1.0, 2);
      }
      if (queue.length > 0) scheduleDrain();
    });
  } else {
    // Headless / test environments without rAF drain immediately so tests see deterministic disposal.
    flushDeferredDispose();
  }
}

/** Queues one or more cleanup callbacks to run across idle animation frame slices. */
export function enqueueDeferredDispose(...tasks: Array<DisposeTask | null | undefined>): void {
  for (const t of tasks) {
    if (typeof t === 'function') queue.push(t);
  }
  scheduleDrain();
}

/**
 * Runs queued disposal tasks up to `budgetMs` AND at most `maxTasks` per frame so fast JS `dispose()` calls never
 * flood the GPU command buffer with dozens of `gl.deleteBuffer` / `gl.deleteTexture` / `gl.deleteProgram` commands in a single VSync.
 */
export function stepDeferredDispose(budgetMs = 1.0, maxTasks = 2): number {
  if (queue.length === 0) return 0;
  const start = nowMs();
  lastStepAtMs = start;
  const deadline = start + Math.max(0.1, budgetMs);
  const cap = Math.max(1, Math.trunc(maxTasks));
  let ran = 0;
  while (queue.length > 0 && ran < cap) {
    const task = queue.shift()!;
    try {
      task();
    } catch (err) {
      console.warn('deferred dispose failed', err);
    }
    ran++;
    if (nowMs() >= deadline) break;
  }
  if (queue.length > 0) scheduleDrain();
  return ran;
}

/** Synchronously drains every pending disposal task (used on full app teardown and in unit tests). */
export function flushDeferredDispose(): number {
  if (scheduledRaf !== 0 && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(scheduledRaf);
    scheduledRaf = 0;
  }
  let ran = 0;
  while (queue.length > 0) {
    const task = queue.shift()!;
    try {
      task();
    } catch (err) {
      console.warn('deferred dispose failed', err);
    }
    ran++;
  }
  return ran;
}

export function pendingDeferredDisposeCount(): number {
  return queue.length;
}
