import type { PooledObject } from './PooledObject';

export interface PoolThresholdSpec {
  /** Number of instances eagerly pre-allocated when the pool is initialized at level load. */
  readonly initialSize: number;
  /**
   * Smart retention / capacity threshold for this pool (e.g., `10` for HQ buildings/units vs `100` for workers).
   * Up to `threshold` objects remain permanently pooled and are never deleted on release; if `hardCap` is true,
   * total active instances never exceed `threshold`. If `hardCap` is false and a temporary spike exceeds `threshold`,
   * excess overflow instances are trimmed back down to `threshold` upon release.
   */
  readonly threshold: number;
  /** When true, the pool never allocates beyond `threshold` (`tryAcquire()` returns `null` at capacity). */
  readonly hardCap?: boolean;
}

export interface ObjectPoolOptions<T extends PooledObject> extends PoolThresholdSpec {
  readonly key: string;
  readonly create: (slotIndex: number, key: string) => T;
}

export interface PoolStats {
  readonly key: string;
  readonly active: number;
  readonly available: number;
  readonly allocated: number;
  readonly initialSize: number;
  readonly threshold: number;
  readonly hardCap: boolean;
  readonly reuseHits: number;
  readonly allocations: number;
  readonly trimmedOverflow: number;
}

/**
 * Generic O(1) object pool with smart per-archetype thresholds and prewarming.
 * Guarantees pooled objects within `threshold` are allocated once and recycled without runtime deletion.
 */
export class ObjectPool<T extends PooledObject> {
  readonly key: string;
  readonly initialSize: number;
  readonly threshold: number;
  readonly hardCap: boolean;

  private readonly createFn: (slotIndex: number, key: string) => T;
  private readonly free: T[] = [];
  private readonly activeSet = new Set<T>();
  private nextSlotIndex = 0;
  private reuseHits = 0;
  private allocations = 0;
  private trimmedOverflow = 0;
  private disposed = false;

  constructor(opts: ObjectPoolOptions<T>) {
    this.key = opts.key;
    this.threshold = Math.max(1, Math.floor(opts.threshold));
    this.initialSize = Math.max(0, Math.min(this.threshold, Math.floor(opts.initialSize)));
    this.hardCap = Boolean(opts.hardCap);
    this.createFn = opts.create;
    if (this.initialSize > 0) {
      this.prewarm(this.initialSize);
    }
  }

  get activeCount(): number {
    return this.activeSet.size;
  }

  get availableCount(): number {
    return this.free.length;
  }

  get allocatedCount(): number {
    return this.activeSet.size + this.free.length;
  }

  /** Pre-allocates idle instances into the free pool up to `min(targetCount, threshold)`. */
  prewarm(targetCount = this.initialSize): void {
    if (this.disposed) return;
    const clamped = Math.max(0, Math.min(this.threshold, Math.floor(targetCount)));
    while (this.allocatedCount < clamped) {
      const item = this.allocateOne();
      this.free.push(item);
    }
  }

  /** Acquires a pooled object, or returns `null` if `hardCap` is enabled and `threshold` is reached. */
  tryAcquire(): T | null {
    if (this.disposed) return null;
    let item = this.free.pop();
    if (item) {
      this.reuseHits++;
    } else {
      if (this.hardCap && this.allocatedCount >= this.threshold) {
        return null;
      }
      item = this.allocateOne();
    }
    item.acquire();
    this.activeSet.add(item);
    return item;
  }

  /** Acquires a pooled object (throws only if disposed or `hardCap` is exhausted). */
  acquire(): T {
    const item = this.tryAcquire();
    if (!item) {
      throw new Error(`ObjectPool "${this.key}" exhausted hard threshold (${this.threshold})`);
    }
    return item;
  }

  /** Returns an active object to the pool (or trims it if temporary burst overflow exceeded `threshold`). */
  release(item: T): void {
    if (!this.activeSet.delete(item)) return;
    item.release();
    if (this.disposed || this.free.length + this.activeSet.size >= this.threshold) {
      this.trimmedOverflow++;
      item.dispose();
      return;
    }
    this.free.push(item);
  }

  /** Releases all currently active items back into the warm pool without deleting them. */
  releaseAll(): void {
    for (const item of [...this.activeSet]) {
      this.release(item);
    }
  }

  forEachActive(fn: (item: T) => void): void {
    for (const item of this.activeSet) {
      fn(item);
    }
  }

  stats(): PoolStats {
    return {
      key: this.key,
      active: this.activeSet.size,
      available: this.free.length,
      allocated: this.allocatedCount,
      initialSize: this.initialSize,
      threshold: this.threshold,
      hardCap: this.hardCap,
      reuseHits: this.reuseHits,
      allocations: this.allocations,
      trimmedOverflow: this.trimmedOverflow,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const item of this.activeSet) {
      item.release();
      item.dispose();
    }
    this.activeSet.clear();
    for (const item of this.free) {
      item.dispose();
    }
    this.free.length = 0;
  }

  private allocateOne(): T {
    const slot = this.nextSlotIndex++;
    this.allocations++;
    return this.createFn(slot, this.key);
  }
}
