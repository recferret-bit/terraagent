import { parentPort, workerData } from 'node:worker_threads';
import { TICK_MS } from '@terra/sim';
import { PlanetHost } from './planet-host';
import type { FromThread, ThreadInit, ToThread } from './protocol';

/** Sim thread entry (SIM-H-01): owns the planets assigned to it; the main thread talks to it only through `protocol.ts` messages. */
const port = parentPort;
if (!port) throw new Error('sim-thread must run inside a worker_thread');
const init = workerData as ThreadInit;

const host = new PlanetHost(init.thread, init.flags, (msg: FromThread, transfer) => port.postMessage(msg, transfer ?? []));

// PLACEHOLDER scheduler: a plain interval stepping every loaded planet once per TICK_MS. The scheduler issue replaces
// this block with drift-free timing, catch-up, coarse stepping of empty planets and the lag metric.
const timer = init.autoStep ? setInterval(() => host.stepAll(1), TICK_MS) : undefined;

port.on('message', (msg: ToThread) => {
  if (msg.t === 'ctl' && msg.op === 'stop') {
    if (timer) clearInterval(timer);
    port.postMessage({ t: 'stopped', thread: init.thread } satisfies FromThread);
    port.close();
    return;
  }
  host.handle(msg);
});

port.postMessage({ t: 'ready', thread: init.thread } satisfies FromThread);
