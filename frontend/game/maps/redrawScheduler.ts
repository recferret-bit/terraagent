export const MINIMAP_MAX_HZ = 4;
export const MINIMAP_MIN_INTERVAL_MS = 1000 / MINIMAP_MAX_HZ; // 250 ms

export const GLOBAL_MAP_MAX_HZ = 2;
export const GLOBAL_MAP_MIN_INTERVAL_MS = 1000 / GLOBAL_MAP_MAX_HZ; // 500 ms

export interface MapRedrawSchedulerOptions {
  onRedrawMinimap?: () => void;
  onRedrawGlobalMap?: () => void;
  isGlobalMapOpen?: () => boolean;
  isHidden?: () => boolean;
  now?: () => number;
  autoSchedule?: boolean;
}

export class MapRedrawScheduler {
  private readonly onRedrawMinimap?: () => void;
  private readonly onRedrawGlobalMap?: () => void;
  private readonly isGlobalMapOpenFn: () => boolean;
  private readonly isHiddenFn: () => boolean;
  private readonly nowFn: () => number;
  private readonly autoSchedule: boolean;

  private _minimapPending: boolean = false;
  private _globalMapPending: boolean = false;
  private _lastMinimapMs: number = -Infinity;
  private _lastGlobalMs: number = -Infinity;

  public minimapRedraws: number = 0;
  public globalMapRedraws: number = 0;

  private minimapTimestamps: number[] = [];
  private globalMapTimestamps: number[] = [];

  private timerId: ReturnType<typeof setTimeout> | null = null;
  private visibilityListener: (() => void) | null = null;
  private disposed: boolean = false;

  constructor(options: MapRedrawSchedulerOptions = {}) {
    this.onRedrawMinimap = options.onRedrawMinimap;
    this.onRedrawGlobalMap = options.onRedrawGlobalMap;
    this.isGlobalMapOpenFn = options.isGlobalMapOpen ?? (() => true);
    this.isHiddenFn =
      options.isHidden ??
      (() => {
        if (typeof document !== 'undefined') {
          return Boolean(document.hidden || document.visibilityState === 'hidden');
        }
        return false;
      });
    this.nowFn =
      options.now ??
      (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.autoSchedule = options.autoSchedule ?? true;

    this.setupVisibilityListener();
  }

  private setupVisibilityListener(): void {
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      this.visibilityListener = () => {
        if (!this.isHidden()) {
          this.flushPending();
        }
      };
      document.addEventListener('visibilitychange', this.visibilityListener);
    }
  }

  public now(): number {
    return this.nowFn();
  }

  public isHidden(): boolean {
    return this.isHiddenFn();
  }

  public isGlobalMapOpen(): boolean {
    return this.isGlobalMapOpenFn();
  }

  public get minimapPending(): boolean {
    return this._minimapPending;
  }

  public get globalMapPending(): boolean {
    return this._globalMapPending;
  }

  public get lastMinimapMs(): number {
    return this._lastMinimapMs;
  }

  public get lastGlobalMs(): number {
    return this._lastGlobalMs;
  }

  public markDirty(opts?: { minimap?: boolean; globalMap?: boolean }): void {
    if (this.disposed) return;
    const markMinimap = opts?.minimap ?? true;
    const markGlobal = opts?.globalMap ?? true;
    if (markMinimap) this._minimapPending = true;
    if (markGlobal) this._globalMapPending = true;
    this.tick();
  }

  public tick(nowMs?: number): void {
    if (this.disposed || this.isHidden()) return;
    const currentTime = nowMs ?? this.now();

    if (this._minimapPending && currentTime - this._lastMinimapMs >= MINIMAP_MIN_INTERVAL_MS) {
      this.executeMinimapRedraw(currentTime);
    }
    if (
      this._globalMapPending &&
      this.isGlobalMapOpen() &&
      currentTime - this._lastGlobalMs >= GLOBAL_MAP_MIN_INTERVAL_MS
    ) {
      this.executeGlobalMapRedraw(currentTime);
    }
    if (this.autoSchedule) {
      this.scheduleNextTimer(currentTime);
    }
  }

  public flushPending(): void {
    if (this.disposed || this.isHidden()) return;
    const currentTime = this.now();
    if (this._minimapPending) {
      this.executeMinimapRedraw(currentTime);
    }
    if (this._globalMapPending && this.isGlobalMapOpen()) {
      this.executeGlobalMapRedraw(currentTime);
    }
    if (this.autoSchedule) {
      this.scheduleNextTimer(currentTime);
    }
  }

  public forceRedrawMinimap(): void {
    if (this.disposed) return;
    this.executeMinimapRedraw(this.now());
  }

  public forceRedrawGlobalMap(): void {
    if (this.disposed) return;
    this.executeGlobalMapRedraw(this.now());
  }

  private executeMinimapRedraw(now: number): void {
    this._minimapPending = false;
    this._lastMinimapMs = now;
    this.minimapRedraws++;
    this.minimapTimestamps.push(now);
    this.pruneTimestamps(this.minimapTimestamps, now);
    try {
      this.onRedrawMinimap?.();
    } catch (err) {
      console.error('MapRedrawScheduler onRedrawMinimap failed:', err);
    }
  }

  private executeGlobalMapRedraw(now: number): void {
    this._globalMapPending = false;
    this._lastGlobalMs = now;
    this.globalMapRedraws++;
    this.globalMapTimestamps.push(now);
    this.pruneTimestamps(this.globalMapTimestamps, now);
    try {
      this.onRedrawGlobalMap?.();
    } catch (err) {
      console.error('MapRedrawScheduler onRedrawGlobalMap failed:', err);
    }
  }

  private scheduleNextTimer(now: number): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (this.disposed || this.isHidden()) return;

    const needsMinimap = this._minimapPending;
    const needsGlobal = this._globalMapPending && this.isGlobalMapOpen();
    if (!needsMinimap && !needsGlobal) return;

    let delay = Infinity;
    if (needsMinimap) {
      const due = this._lastMinimapMs + MINIMAP_MIN_INTERVAL_MS;
      delay = Math.min(delay, Math.max(0, due - now));
    }
    if (needsGlobal) {
      const due = this._lastGlobalMs + GLOBAL_MAP_MIN_INTERVAL_MS;
      delay = Math.min(delay, Math.max(0, due - now));
    }
    if (!Number.isFinite(delay)) return;

    this.timerId = setTimeout(() => {
      this.timerId = null;
      this.tick();
    }, delay);
  }

  private pruneTimestamps(list: number[], now: number): void {
    const cutoff = now - 10_000;
    while (list.length > 0 && list[0] < cutoff) {
      list.shift();
    }
  }

  private calculateRate(timestamps: readonly number[], windowMs: number): number {
    if (windowMs <= 0 || timestamps.length === 0) return 0;
    const now = this.now();
    const cutoff = now - windowMs;
    let count = 0;
    for (let i = timestamps.length - 1; i >= 0; i--) {
      const t = timestamps[i];
      if (t > cutoff && t <= now) {
        count++;
      } else if (t <= cutoff) {
        break;
      }
    }
    return windowMs === 1000 ? count : (count * 1000) / windowMs;
  }

  public minimapHz(windowMs = 1000): number {
    if (this.isHidden()) return 0;
    return this.calculateRate(this.minimapTimestamps, windowMs);
  }

  public globalMapHz(windowMs = 1000): number {
    if (this.isHidden()) return 0;
    return this.calculateRate(this.globalMapTimestamps, windowMs);
  }

  public resetStats(): void {
    this.minimapRedraws = 0;
    this.globalMapRedraws = 0;
    this.minimapTimestamps = [];
    this.globalMapTimestamps = [];
    this._lastMinimapMs = -Infinity;
    this._lastGlobalMs = -Infinity;
  }

  public dispose(): void {
    this.disposed = true;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (
      this.visibilityListener &&
      typeof document !== 'undefined' &&
      typeof document.removeEventListener === 'function'
    ) {
      document.removeEventListener('visibilitychange', this.visibilityListener);
      this.visibilityListener = null;
    }
  }
}
