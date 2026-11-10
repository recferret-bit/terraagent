import { parentPort, workerData } from 'node:worker_threads';
import { PlanetScheduler, type SimModule } from '@terra/sim';
import { runCoarseCatchUp } from '../restart/fast-run';
import { PlanetHost } from './planet-host';
import type { FromThread, PassStat, ThreadInit, ToThread } from './protocol';

/** Sim thread entry (SIM-H-01): owns the planets assigned to it; the main thread talks to it only through `protocol.ts` messages. */
const port = parentPort;
if (!port) throw new Error('sim-thread must run inside a worker_thread');
const init = workerData as ThreadInit;
const post = (msg: FromThread, transfer?: ArrayBuffer[]) => port.postMessage(msg, transfer ?? []);

const RING = 64;
const ring: PassStat[] = [];

// SIM-H-03..05: one drift-free loop per thread. With `autoStep: false` no loop runs (tests drive `stepPlanet` directly).
const scheduler = new PlanetScheduler({
  now: () => performance.now(),
  schedule: (fn, delayMs) => { const t = setTimeout(fn, delayMs); return () => clearTimeout(t); },
  // A throwing step drops the planet from the host (BE-12, `planetFailed`); stop scheduling it too.
  step: (planetId, dt) => { if (!host.stepPlanet(planetId, dt)) scheduler.remove(planetId); },
});
scheduler.onPass = (r) => {
  host.flushDeltas();
  if (r.steps === 0) return;
  ring.push({ steps: r.steps, maxPlanetSteps: r.maxPlanetSteps, maxLag: r.maxLag });
  if (ring.length > RING) ring.shift();
};

scheduler.onWarp = (planetId, k, requested) => post({ t: 'warp', planetId, k, requested });

const host = new PlanetHost(init.thread, init.flags, post, {
  info: (id) => scheduler.info(id),
  setMode: (id, mode) => scheduler.setMode(id, mode),
  get maxLag() { return scheduler.maxLag; },
  recentPasses: () => [...ring],
}, {
  deltaHz: init.deltaHz,
  overrides: init.overrides,
  modules: await Promise.all((init.simModules ?? []).map(async (u) => ((await import(u)) as { default: SimModule }).default)),
});
if (init.autoStep) scheduler.start();

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
    step: (dt) => host.planets.has(planetId) && host.stepPlanet(planetId, dt),
  });
  if (!host.planets.has(planetId)) {
    post({ t: 'error', thread: init.thread, planetId, message: `fast-run of ${planetId} stopped` });
    return;
  }
  const tick = host.planets.get(planetId)!.state.meta.tick;
  scheduler.add(planetId);
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
    scheduler.add(msg.planetId);
  } else if ('planetId' in msg && msg.planetId && !host.planets.has(msg.planetId)) scheduler.remove(msg.planetId); // unloaded or failed
});

post({ t: 'ready', thread: init.thread });
