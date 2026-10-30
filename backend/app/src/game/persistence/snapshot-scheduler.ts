import { hashString } from '@terra/sim';
import type { SnapshotKind } from './snapshot-store';

/** Offset inside the period at which a planet's periodic snapshot fires: spreads planets over the whole interval. */
export function staggerOffsetMs(planetId: string, periodMs: number): number {
  return hashString(planetId) % Math.max(1, Math.floor(periodMs));
}

export interface SnapshotPayload { readonly tick: number; readonly bytes: Uint8Array }

/** What the scheduler needs from `GamePlanets`. */
export interface SnapshotSource {
  loadedIds(): string[];
  requestSnapshot(planetId: string): void;
}

export type SnapshotWriter = (planetId: string, snap: SnapshotPayload & { readonly kind: SnapshotKind; readonly savedAt: Date }) => Promise<void>;

interface Pending {
  tick: number;
  bytes: Uint8Array;
  kind: SnapshotKind;
  savedAt: Date;
  dones: (() => void)[];
}

interface PlanetFlow {
  /** Kinds of snapshot requests not yet answered by the thread, oldest first (the thread answers in order). */
  asked: { kind: SnapshotKind; done?: () => void }[];
  inflight: boolean;
  queued?: Pending;
}

/**
 * Per-planet snapshot flow on the main thread: staggered periodic requests, at most one write in flight per planet,
 * and a newer snapshot replaces a queued (not yet started) one.
 */
export class SnapshotScheduler {
  private readonly planets = new Map<string, PlanetFlow>();
  private readonly timers = new Map<string, { start: ReturnType<typeof setTimeout>; every?: ReturnType<typeof setInterval> }>();
  private stopped = false;

  constructor(
    private readonly source: SnapshotSource,
    private readonly write: SnapshotWriter,
    private readonly periodMs: number,
    private readonly onError: (planetId: string, e: unknown) => void = () => {},
  ) {}

  /** Starts the periodic timer of a planet (first fire after its stagger offset). */
  track(planetId: string): void {
    if (this.stopped || this.timers.has(planetId)) return;
    const fire = () => this.request(planetId, 'PERIODIC');
    const start = setTimeout(() => {
      fire();
      const t = this.timers.get(planetId);
      if (t) t.every = setInterval(fire, this.periodMs);
    }, staggerOffsetMs(planetId, this.periodMs));
    this.timers.set(planetId, { start });
  }

  untrack(planetId: string): void {
    const t = this.timers.get(planetId);
    if (t) { clearTimeout(t.start); clearInterval(t.every); }
    this.timers.delete(planetId);
  }

  /** Asks the planet's thread for a snapshot; `done` fires once the resulting (or a newer coalesced) write has finished. */
  request(planetId: string, kind: SnapshotKind, done?: () => void): void {
    const st = this.flow(planetId);
    // A periodic request while one is already unanswered adds nothing.
    if (kind === 'PERIODIC' && st.asked.some((a) => a.kind === 'PERIODIC')) return;
    st.asked.push({ kind, done });
    this.source.requestSnapshot(planetId);
  }

  /** A `snapshot` message from the thread arrived. */
  onSnapshot(planetId: string, snap: SnapshotPayload, savedAt = new Date()): void {
    const st = this.flow(planetId);
    const ask = st.asked.shift();
    const kind = ask?.kind ?? 'PERIODIC';
    const q = st.queued;
    st.queued = {
      tick: snap.tick, bytes: snap.bytes, savedAt,
      kind: q && q.kind !== 'PERIODIC' && kind === 'PERIODIC' ? q.kind : kind,
      dones: [...(q?.dones ?? []), ...(ask?.done ? [ask.done] : [])],
    };
    void this.pump(planetId, st);
  }

  /** Snapshots every loaded planet with `kind` and resolves when all writes finished or `budgetMs` passed. Stops periodic work. */
  async flushAll(kind: SnapshotKind, budgetMs: number): Promise<{ planets: number; timedOut: boolean }> {
    this.stopped = true;
    for (const id of [...this.timers.keys()]) this.untrack(id);
    const ids = this.source.loadedIds();
    const all = Promise.all(ids.map((id) => new Promise<void>((resolve) => this.request(id, kind, resolve)))).then(() => false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(true), budgetMs); });
    const timedOut = await Promise.race([all, timeout]);
    clearTimeout(timer);
    return { planets: ids.length, timedOut };
  }

  /** Resolves when no write is running or queued (tests). */
  async idle(): Promise<void> {
    while ([...this.planets.values()].some((s) => s.inflight || s.queued)) await new Promise((r) => setTimeout(r, 5));
  }

  private flow(planetId: string): PlanetFlow {
    let st = this.planets.get(planetId);
    if (!st) this.planets.set(planetId, (st = { asked: [], inflight: false }));
    return st;
  }

  private async pump(planetId: string, st: PlanetFlow): Promise<void> {
    if (st.inflight || !st.queued) return;
    const job = st.queued;
    st.queued = undefined;
    st.inflight = true;
    try {
      await this.write(planetId, job);
    } catch (e) {
      this.onError(planetId, e);
    } finally {
      st.inflight = false;
      for (const d of job.dones) d();
      void this.pump(planetId, st);
    }
  }
}
