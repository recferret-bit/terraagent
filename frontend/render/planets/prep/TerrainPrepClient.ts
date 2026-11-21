import type { PlanetKind } from '../PlanetSpec';
import type { TerrainGridData } from '../../visuals/terrain/TerrainGrid';
import type { HexTiles, PrecomputedHexTerrainData } from '../hex/createHexTerrain';
import { cloneTilesForWorker, handleTerrainPrepRequest } from './terrainPrepCore';
import type { TerrainPrepRequest, TerrainPrepResponse } from './types';

export interface PrepWorkerLike {
  onmessage: ((ev: { data: TerrainPrepResponse }) => void) | null;
  onerror?: ((err: unknown) => void) | null;
  postMessage(msg: TerrainPrepRequest, transfer: Transferable[]): void;
  terminate(): void;
}

function createDefaultPrepWorker(): PrepWorkerLike | null {
  if (typeof Worker !== 'function') return null;
  try {
    return new Worker(new URL('./terrainPrep.worker.ts', import.meta.url), {
      type: 'module',
    }) as unknown as PrepWorkerLike;
  } catch {
    return null;
  }
}

interface PendingJob {
  resolve: (res: TerrainPrepResponse) => void;
  reject: (err: Error) => void;
}

/**
 * Background Web Worker client for precomputing heavy planet surface grids (219 ms) and hex terrain chunks/props/water
 * off the main thread during Orbit and Atmospheric Descent, then unloading cached buffers and terminating the worker
 * once the pod has landed (`unloadLanded()`).
 */
export class TerrainPrepClient {
  private worker: PrepWorkerLike | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingJob>();
  private readonly surfaceCache = new Map<string, TerrainGridData>();
  private readonly surfaceInFlight = new Map<string, Promise<TerrainGridData>>();
  private unloadEpoch = 0;

  constructor(private readonly makeWorker: () => PrepWorkerLike | null = createDefaultPrepWorker) {}

  get hasActiveWorker(): boolean {
    return this.worker !== null;
  }

  get cachedSurfaceCount(): number {
    return this.surfaceCache.size;
  }

  private ensureWorker(): PrepWorkerLike | null {
    if (this.worker) return this.worker;
    const w = this.makeWorker();
    if (!w) return null;
    w.onmessage = (ev) => {
      const msg = ev.data;
      const job = this.pending.get(msg.id);
      if (!job) return;
      this.pending.delete(msg.id);
      if (msg.type === 'error') job.reject(new Error(msg.message));
      else job.resolve(msg);
    };
    w.onerror = (err) => {
      const error = err instanceof Error ? err : new Error('Terrain prep worker error');
      for (const job of this.pending.values()) job.reject(error);
      this.pending.clear();
      this.worker?.terminate();
      this.worker = null;
    };
    this.worker = w;
    return w;
  }

  private dispatch(req: TerrainPrepRequest, transfer: Transferable[]): Promise<TerrainPrepResponse> {
    const w = this.ensureWorker();
    if (!w) {
      // Fallback for headless test environments without Web Workers.
      return new Promise((resolve, reject) => {
        queueMicrotask(() => {
          const { response } = handleTerrainPrepRequest(req);
          if (response.type === 'error') reject(new Error(response.message));
          else resolve(response);
        });
      });
    }
    return new Promise<TerrainPrepResponse>((resolve, reject) => {
      this.pending.set(req.id, { resolve, reject });
      w.postMessage(req, transfer);
    });
  }

  surfaceKey(kind: PlanetKind, seed: number, quality: 'low' | 'high', halfSize = 64): string {
    return `${kind}:${seed}:${quality}:${halfSize}`;
  }

  /** Returns an already precomputed `TerrainGridData` if cached, consuming it so its buffers aren't retained twice. */
  takeCachedSurface(kind: PlanetKind, seed: number, quality: 'low' | 'high', halfSize = 64): TerrainGridData | undefined {
    const key = this.surfaceKey(kind, seed, quality, halfSize);
    const hit = this.surfaceCache.get(key);
    if (hit) this.surfaceCache.delete(key);
    return hit;
  }

  /** Precomputes `PlanetSurface` heightfield, normals, AO, bedrock mask, HalfFloat height texture, and descent globe spheres in the worker. */
  preloadSurface(
    kind: PlanetKind,
    seed: number,
    quality: 'low' | 'high' = 'high',
    halfSize = 64,
    includeDescentGlobe = halfSize === 64,
  ): Promise<TerrainGridData> {
    const key = this.surfaceKey(kind, seed, quality, halfSize);
    const cached = this.surfaceCache.get(key);
    if (cached) return Promise.resolve(cached);
    const inflight = this.surfaceInFlight.get(key);
    if (inflight) return inflight;

    const id = this.nextId++;
    const epoch = this.unloadEpoch;
    const p = this.dispatch({ id, type: 'surface', kind, seed, halfSize, quality, includeDescentGlobe }, [])
      .then((res) => {
        if (res.type !== 'surface') throw new Error('Unexpected worker response');
        if (epoch === this.unloadEpoch) {
          if (!this.surfaceCache.has(key) && this.surfaceCache.size >= 2) {
            const oldest = this.surfaceCache.keys().next().value;
            if (oldest !== undefined) this.surfaceCache.delete(oldest);
          }
          this.surfaceCache.set(key, res.grid);
        }
        return res.grid;
      })
      .finally(() => {
        this.surfaceInFlight.delete(key);
      });
    this.surfaceInFlight.set(key, p);
    return p;
  }

  /** Precomputes `HexTerrain` effective heights, tint maps, shore-field HalfFloat texture, chunks, and props in worker. */
  async preloadHexTerrain(
    radius: number,
    kind: PlanetKind,
    seed: number,
    tiles: HexTiles,
  ): Promise<PrecomputedHexTerrainData> {
    const id = this.nextId++;
    const { cloned, transfer } = cloneTilesForWorker(tiles);
    const res = await this.dispatch({ id, type: 'hexTerrain', radius, kind, seed, tiles: cloned }, transfer);
    if (res.type !== 'hexTerrain') throw new Error('Unexpected worker response');
    return res.data;
  }

  /**
   * Unloads all cached preload buffers and terminates the background worker once the pod has landed on the colony
   * surface (`0 MB` idle worker overhead during gameplay; respawns on demand if the player returns to orbit).
   */
  unloadLanded(terminateWorker = true): void {
    this.unloadEpoch++;
    this.surfaceCache.clear();
    this.surfaceInFlight.clear();
    if (terminateWorker) {
      for (const job of this.pending.values()) {
        job.reject(new Error('Terrain prep unloaded'));
      }
      this.pending.clear();
      this.worker?.terminate();
      this.worker = null;
    }
  }
}

let sharedTerrainPrep: TerrainPrepClient | null = null;

export function getSharedTerrainPrep(): TerrainPrepClient {
  return (sharedTerrainPrep ??= new TerrainPrepClient());
}
