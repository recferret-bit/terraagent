import { parentPort, workerData } from 'node:worker_threads';
import { PlanetScheduler, type SimModule } from '@terra/sim';
import { FAST_RUN_MAX_WALL_MS, runCoarseCatchUp } from '../restart/fast-run';
import { PlanetHost } from './planet-host';
import type { FromThread, PassStat, ThreadInit, ToThread } from './protocol';
import { ThreadLoadMeter } from './step-metrics';

/** Sim thread entry (SIM-H-01): owns the planets assigned to it; the main thread talks to it only through `protocol.ts` messages. */
const port = parentPort;
if (!port) throw new Error('sim-thread must run inside a worker_thread');
const init = workerData as ThreadInit;
const post = (msg: FromThread, transfer?: ArrayBuffer[]) => port.postMessage(msg, transfer ?? []);

const RING = 64;
const ring: PassStat[] = [];
const meter = new ThreadLoadMeter(() => performance.now());

// SIM-H-03..05: one drift-free, fair loop per thread. A due-now turn goes through `setImmediate`, so the port's messages
// (commands, stats) are handled between any two turns. With `autoStep: false` no loop runs (tests drive `stepPlanet`).
const scheduler = new PlanetScheduler({
  now: () => performance.now(),
  schedule: (fn, delayMs) => {
    if (delayMs <= 0) { const t = setImmediate(fn); return () => clearImmediate(t); }
    const t = setTimeout(fn, delayMs);
    return () => clearTimeout(t);
  },
  // A throwing step drops the planet from the host (BE-12, `planetFailed`); stop scheduling it too.
  step: (planetId, dt) => { if (!host.stepPlanet(planetId, dt)) scheduler.remove(planetId); },
});
scheduler.onStep = (planetId, r) => {
  host.flushDelta(planetId);
  const slow = meter.record(planetId, r.ms, r.steps);
  if (slow) post({ t: 'slowStep', thread: init.thread, planetId, ms: Math.round(slow.ms), mode: r.mode, suppressed: slow.suppressed });
};
scheduler.onPass = (r) => {
  host.flushDeltas();
  if (r.steps === 0) return;
  ring.push({ steps: r.steps, maxPlanetSteps: r.maxPlanetSteps, maxLag: r.maxLag });
  if (ring.length > RING) ring.shift();
};
scheduler.onWarp = (planetId, k, requested) => post({ t: 'warp', planetId, k, requested });
scheduler.onDemote = (planetId, avgStepMs) => post({ t: 'demoted', thread: init.thread, planetId, avgStepMs: Math.round(avgStepMs) });

const host = new PlanetHost(init.thread, init.flags, post, {
  info: (id) => scheduler.info(id),
  setMode: (id, mode) => scheduler.setMode(id, mode),
  setPlayers: (id, on) => scheduler.setPlayers(id, on),
  get maxLag() { return scheduler.maxLag; },
  recentPasses: () => [...ring],
  load: () => ({ busyRatio: meter.busyRatio, droppedSlots: scheduler.droppedSlots }),
  loadOf: (id) => meter.loadOf(id),
}, {
  deltaHz: init.deltaHz,
  overrides: init.overrides,
  modules: await Promise.all((init.simModules ?? []).map(async (u) => ((await import(u)) as { default: SimModule }).default)),
});
if (init.autoStep) scheduler.start();

// Observability 0.6: the main thread caches this push, so `/v1/metrics` never waits on a busy thread.
const statsEveryMs = init.statsEveryMs ?? 1000;
if (statsEveryMs > 0) setInterval(() => { const samples = meter.roll(); post(host.statsMsg(0, samples)); }, statsEveryMs).unref();

/** Joins the scheduler, with the subscription it may have gained while it was catching up. */
function schedule(planetId: string): void {
  scheduler.add(planetId);
  scheduler.setPlayers(planetId, host.planets.get(planetId)?.subscribed ?? false);
}

const catchUpTicksOf = (msg: ToThread): number => {
  if (msg.t !== 'load' || msg.catchUpTicks === undefined) return 0;
  const n = Math.floor(msg.catchUpTicks);
  return n > 0 ? n : 0;
};

/** Coarse-steps the restored gap, then schedules the planet `active` (not left coarse, BE-57). */
async function finishCatchUp(planetId: string, ticks: number): Promise<void> {
  const t0 = performance.now();
  // A missing planet (unloaded mid-run) stops the loop; `stepPlanet` would otherwise report success.
  const ran = await runCoarseCatchUp({
    ticks,
    step: (dt) => {
      if (!host.planets.has(planetId)) return false;
      const s = performance.now();
      const ok = host.stepPlanet(planetId, dt);
      meter.recordBusy(planetId, performance.now() - s);
      return ok;
    },
    ...(init.autoStep ? { maxWallMs: FAST_RUN_MAX_WALL_MS } : {}),
  });
  if (!host.planets.has(planetId)) {
    post({ t: 'error', thread: init.thread, planetId, message: `fast-run of ${planetId} stopped` });
    return;
  }
  const tick = host.planets.get(planetId)!.state.meta.tick;
  schedule(planetId);
  post({ t: 'fastRan', planetId, tick, ticks: ran.advanced, seconds: (performance.now() - t0) / 1000 });
}

port.on('message', (msg: ToThread) => {
  if (msg.t === 'ctl' && msg.op === 'stop') {
    scheduler.stop();
    post({ t: 'stopped', thread: init.thread });
    port.close();
    return;
  }
  if (msg.t === 'ctl' && msg.op === 'warp') {
    if (host.planets.has(msg.planetId)) scheduler.setWarp(msg.planetId, msg.k);
    return;
  }
  const catchUpTicks = catchUpTicksOf(msg);
  host.handle(msg);
  if (msg.t === 'load' && host.planets.has(msg.planetId)) {
    if (catchUpTicks > 0) {
      void finishCatchUp(msg.planetId, catchUpTicks);
      return;
    }
    schedule(msg.planetId);
    if (msg.moved?.mode) scheduler.setMode(msg.planetId, msg.moved.mode);
    if (msg.moved?.warp !== undefined && msg.moved.warp !== 1) scheduler.setWarp(msg.planetId, msg.moved.warp);
  } else if ('planetId' in msg && msg.planetId && !host.planets.has(msg.planetId)) { // unloaded, handed off or failed
    scheduler.remove(msg.planetId);
    meter.forget(msg.planetId);
  }
});

post({ t: 'ready', thread: init.thread });
