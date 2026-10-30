import { parentPort, workerData } from 'node:worker_threads';
import { PlanetHost } from './planet-host';
import type { FromThread, PassStat, ThreadInit, ToThread } from './protocol';
import { PlanetScheduler } from './scheduler';

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
  step: (planetId, dt) => {
    try { host.stepPlanet(planetId, dt); } catch (e) {
      post({ t: 'error', thread: init.thread, planetId, message: e instanceof Error ? e.message : String(e) });
    }
  },
});
scheduler.onPass = (r) => {
  if (r.steps === 0) return;
  ring.push({ steps: r.steps, maxPlanetSteps: r.maxPlanetSteps, maxLag: r.maxLag });
  if (ring.length > RING) ring.shift();
};

const host = new PlanetHost(init.thread, init.flags, post, {
  info: (id) => scheduler.info(id),
  get maxLag() { return scheduler.maxLag; },
  recentPasses: () => [...ring],
});
if (init.autoStep) scheduler.start();

port.on('message', (msg: ToThread) => {
  if (msg.t === 'ctl' && msg.op === 'stop') {
    scheduler.stop();
    post({ t: 'stopped', thread: init.thread });
    port.close();
    return;
  }
  host.handle(msg);
  if (msg.t === 'load' && host.planets.has(msg.planetId)) scheduler.add(msg.planetId);
  else if (msg.t === 'unload') scheduler.remove(msg.planetId);
});

post({ t: 'ready', thread: init.thread });
