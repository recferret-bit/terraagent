import { BiomeWorkerController } from './BiomeWorkerController';
import type { BiomeGeneratedPayload, BiomeWorkerTileInput, FromBiomeWorker, ToBiomeWorker } from './protocol';

export interface BiomeWorkerLike {
  postMessage(msg: ToBiomeWorker, transfer: Transferable[]): void;
  onmessage: ((e: { data: FromBiomeWorker }) => void) | null;
  onerror?: ((e: { message?: string; error?: unknown }) => void) | null;
  terminate(): void;
}

export function createDefaultBiomeWorker(): BiomeWorkerLike {
  if (typeof Worker === 'function') {
    return new Worker(new URL('./biome.worker.ts', import.meta.url), {
      type: 'module',
    }) as unknown as BiomeWorkerLike;
  }
  const w: BiomeWorkerLike = {
    onmessage: null,
    terminate() {},
    postMessage(msg) {
      queueMicrotask(() => ctl.handle(msg));
    },
  };
  const ctl = new BiomeWorkerController((m: FromBiomeWorker) =>
    queueMicrotask(() => w.onmessage?.({ data: m })),
  );
  return w;
}

function cloneTilesForTransfer(tiles: {
  terrain: ArrayLike<number>;
  height: ArrayLike<number>;
  prep?: ArrayLike<number>;
  deposit?: ArrayLike<number>;
  richness?: ArrayLike<number>;
  depositTier?: ArrayLike<number>;
  owner?: ArrayLike<number>;
}): { copy: BiomeWorkerTileInput; transfer: Transferable[] } {
  const terrain = Uint8Array.from(tiles.terrain);
  const height = Float32Array.from(tiles.height);
  const transfer: Transferable[] = [terrain.buffer, height.buffer];
  const prep = tiles.prep ? Uint8Array.from(tiles.prep) : undefined;
  const deposit = tiles.deposit ? Uint8Array.from(tiles.deposit) : undefined;
  const richness = tiles.richness ? Float32Array.from(tiles.richness) : undefined;
  const depositTier = tiles.depositTier ? Uint8Array.from(tiles.depositTier) : undefined;
  const owner = tiles.owner ? Int16Array.from(tiles.owner) : undefined;
  if (prep) transfer.push(prep.buffer);
  if (deposit) transfer.push(deposit.buffer);
  if (richness) transfer.push(richness.buffer);
  if (depositTier) transfer.push(depositTier.buffer);
  if (owner) transfer.push(owner.buffer);
  return { copy: { terrain, height, prep, deposit, richness, depositTier, owner }, transfer };
}

/**
 * Client handle managing async level-load requests to `biome.worker.ts` (terrain + biome sub-orchestrators).
 */
export class BiomeWorkerClient {
  private worker: BiomeWorkerLike | null = null;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (p: BiomeGeneratedPayload) => void; reject: (err: Error) => void }
  >();
  private disposed = false;

  constructor(private readonly makeWorker: () => BiomeWorkerLike = createDefaultBiomeWorker) {}

  generate(
    jsonConfig: string,
    tiles: {
      terrain: ArrayLike<number>;
      height: ArrayLike<number>;
      prep?: ArrayLike<number>;
      deposit?: ArrayLike<number>;
      richness?: ArrayLike<number>;
      depositTier?: ArrayLike<number>;
      owner?: ArrayLike<number>;
    },
  ): Promise<BiomeGeneratedPayload> {
    if (this.disposed) return Promise.reject(new Error('BiomeWorkerClient disposed'));
    if (!this.worker) {
      this.worker = this.makeWorker();
      this.worker.onmessage = (e) => this.onMessage(e.data);
      this.worker.onerror = (e) => this.onWorkerCrash(e?.message ?? 'BiomeWorker crashed');
    }
    const id = this.nextId++;
    const { copy, transfer } = cloneTilesForTransfer(tiles);
    return new Promise<BiomeGeneratedPayload>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.worker!.postMessage({ t: 'generate', id, jsonConfig, tiles: copy }, transfer);
      } catch (err) {
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private onWorkerCrash(message: string): void {
    const err = new Error(message);
    for (const [, p] of this.pending) {
      p.reject(err);
    }
    this.pending.clear();
    if (this.worker) {
      try { this.worker.terminate(); } catch { /* ignore */ }
      this.worker = null;
    }
  }

  private onMessage(msg: FromBiomeWorker): void {
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);
    if (msg.t === 'generated') entry.resolve(msg.payload);
    else entry.reject(new Error(msg.message));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [, p] of this.pending) {
      p.reject(new Error('BiomeWorkerClient disposed'));
    }
    this.pending.clear();
    if (this.worker) {
      this.worker.postMessage({ t: 'stop' }, []);
      this.worker.terminate();
      this.worker = null;
    }
  }
}
