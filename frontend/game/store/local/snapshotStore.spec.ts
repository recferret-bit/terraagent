import { afterEach, describe, expect, it } from 'vitest';
import { idbSnapshotStore, type LocalSnapshot } from './snapshotStore';

type Handler = (() => void) | null;
interface FakeRequest { result: unknown; error: Error | null; onsuccess: Handler; onerror: Handler; onupgradeneeded?: Handler }

/**
 * The few `indexedDB` calls `idbSnapshotStore` makes, with one switch: `failWrites` fails every `put` request and then
 * its transaction (`onerror`), as a quota error does in a browser.
 */
function fakeIdb(failWrites: boolean): IDBFactory {
  const data = new Map<string, unknown>();
  const later = (fn: () => void) => setTimeout(fn, 0);
  const request = (run: () => unknown, fail: boolean, tx: { onerror: Handler; oncomplete: Handler; error: Error | null }): FakeRequest => {
    const req: FakeRequest = { result: undefined, error: null, onsuccess: null, onerror: null };
    later(() => {
      if (fail) {
        req.error = new Error('QuotaExceededError');
        req.onerror?.();
        tx.error = req.error;
        later(() => tx.onerror?.());
      } else {
        req.result = run();
        req.onsuccess?.();
        later(() => tx.oncomplete?.());
      }
    });
    return req;
  };
  const db = {
    transaction() {
      const tx = {
        error: null as Error | null, oncomplete: null as Handler, onerror: null as Handler, onabort: null as Handler,
        objectStore: () => ({
          get: (k: string) => request(() => data.get(k), false, tx),
          put: (v: unknown, k: string) => request(() => data.set(k, v), failWrites, tx),
          delete: (k: string) => request(() => data.delete(k), false, tx),
        }),
      };
      return tx;
    },
    createObjectStore() {},
  };
  return {
    open() {
      const req: FakeRequest = { result: db, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      later(() => req.onsuccess?.());
      return req;
    },
  } as unknown as IDBFactory;
}

const snap: LocalSnapshot = { bytes: new Uint8Array([1, 2]), tick: 3, savedAt: 4, dataHash: 'h', simVersion: 1, flags: ['W00'] };

const unhandled: unknown[] = [];
const onUnhandled = (e: unknown) => { unhandled.push(e); };
afterEach(() => { process.off('unhandledRejection', onUnhandled); unhandled.length = 0; });

describe('idbSnapshotStore (FA-20)', () => {
  it('round-trips a snapshot through the object store', async () => {
    const store = idbSnapshotStore(fakeIdb(false));
    await store.save('terra-local:w00', snap);
    expect(await store.load('terra-local:w00')).toEqual(snap);
    await store.remove('terra-local:w00');
    expect(await store.load('terra-local:w00')).toBeNull();
  });

  it('a failed write rejects once with the request error and leaves no unobserved rejection behind', async () => {
    process.on('unhandledRejection', onUnhandled);
    const store = idbSnapshotStore(fakeIdb(true));
    await expect(store.save('terra-local:w00', snap)).rejects.toThrow('QuotaExceededError');
    await new Promise((ok) => setTimeout(ok, 20)); // let the transaction's own error fire
    expect(unhandled).toEqual([]);
  });
});
