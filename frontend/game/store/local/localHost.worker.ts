import { LocalHostController } from './LocalHostController';
import { idbSnapshotStore, memorySnapshotStore } from './snapshotStore';
import type { FromLocalHost, ToLocalHost } from './protocol';

/**
 * Thin Worker shell of the local host: a dedicated worker (not the replica's), so the authority keeps its 5 TPS when the
 * tab is in the background and the replica / prediction worker stays exactly as online. Snapshots go to IndexedDB.
 */
const scope = self as unknown as { postMessage(m: FromLocalHost, t: ArrayBuffer[]): void; onmessage: ((e: MessageEvent<ToLocalHost>) => void) | null };
const controller = new LocalHostController((m, t) => scope.postMessage(m, t), {
  now: () => performance.now(),
  wallMs: () => Date.now(),
  schedule: (fn, ms) => { const h = setTimeout(fn, ms); return () => clearTimeout(h); },
  store: typeof indexedDB === 'undefined' ? memorySnapshotStore() : idbSnapshotStore(),
});
scope.onmessage = (e) => controller.handle(e.data);
