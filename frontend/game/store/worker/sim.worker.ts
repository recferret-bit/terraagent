import { SimWorkerController } from './SimWorkerController';
import type { FromWorker, ToWorker } from './protocol';

/** Thin Worker shell: all logic is in `SimWorkerController`. */
const scope = self as unknown as { postMessage(m: FromWorker, t: ArrayBuffer[]): void; onmessage: ((e: MessageEvent<ToWorker>) => void) | null };
const controller = new SimWorkerController((m, t) => scope.postMessage(m, t));
scope.onmessage = (e) => controller.handle(e.data);
