import { BiomeWorkerController } from './BiomeWorkerController';
import type { FromBiomeWorker, ToBiomeWorker } from './protocol';

/** Dedicated Web Worker entry for off-main-thread BiomeOrchestrator + HexTerrain generation. */
const scope = self as unknown as {
  postMessage(msg: FromBiomeWorker, transfer: ArrayBuffer[]): void;
  onmessage: ((e: MessageEvent<ToBiomeWorker>) => void) | null;
};
const controller = new BiomeWorkerController((msg, transfer) => scope.postMessage(msg, transfer));
scope.onmessage = (e) => controller.handle(e.data);
