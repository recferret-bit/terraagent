import { restore } from '../codec/snapshot';
import { snapshot } from '../codec/snapshot';
import type { CompiledDataLike } from '../kernel/config';
import type { CommandOutcome, SimCommand } from '../kernel/commands';
import type { LedgerPosting } from '../kernel/context';
import type { SimEvent } from '../kernel/events';
import type { PlanetState } from '../kernel/state';
import { createPipeline, step, StepError, type Pipeline, type StepResult } from '../kernel/step';
import { createEngineConfig, type EngineConfigInput } from '../systems/registry';
import { clone } from './clone';
import { applyDiff, diffSince } from './diff';
import { view, type SimView } from './view';

export type SimHostOptions = EngineConfigInput & { data?: CompiledDataLike };

/**
 * The engine boundary (D-31): one planet plus its pipeline. Used unchanged by the server sim thread, the client sim
 * worker and the local host. No clock, timers or async: the host that embeds it decides when to `step`.
 */
export class SimHost {
  private st: PlanetState | null = null;
  private queue: SimCommand[] = [];
  private last: StepResult | null = null;
  private readonly eventListeners = new Set<(events: readonly SimEvent[], tick: number) => void>();
  private readonly outcomeListeners = new Set<(outcomes: readonly CommandOutcome[], tick: number) => void>();
  private readonly postingListeners = new Set<(postings: readonly LedgerPosting[], tick: number) => void>();
  readonly pipeline: Pipeline;

  constructor(opts: SimHostOptions | Pipeline) {
    this.pipeline = 'systems' in opts && 'handlers' in opts && 'config' in opts ? opts : createPipeline(createEngineConfig(opts));
  }

  /** Loads a snapshot (bytes) or adopts a state object (no copy; the host owns it afterwards). Clears queued commands. */
  load(from: Uint8Array | PlanetState): void {
    this.st = from instanceof Uint8Array ? restore(from) : from;
    this.queue = [];
    this.last = null;
  }

  get loaded(): boolean { return this.st !== null; }
  get state(): PlanetState {
    if (!this.st) throw new Error('SimHost: no planet loaded');
    return this.st;
  }
  get tick(): number { return this.state.meta.tick; }

  /** Queues a command; it is applied, in arrival order, at the start of the next `step`. */
  submit(cmd: SimCommand): void { this.queue.push(cmd); }
  get pending(): number { return this.queue.length; }

  /** Advances `dt` ticks, draining the queue, then notifies listeners. */
  step(dt: number): StepResult {
    const cmds = this.queue;
    this.queue = []; // applied (or lost with a failed step): never re-applied
    let res: StepResult;
    try {
      res = step(this.state, cmds, dt, this.pipeline);
    } catch (err) {
      // LED-09: what the failed step already did to `col.stock` still reaches the journal, its commands get answered.
      if (err instanceof StepError) {
        if (err.outcomes.length > 0) for (const cb of this.outcomeListeners) cb(err.outcomes, err.tick);
        if (err.postings.length > 0) for (const cb of this.postingListeners) cb(err.postings, err.tick);
      }
      throw err;
    }
    this.last = res;
    for (const cb of this.eventListeners) cb(res.events, res.stats.tick);
    for (const cb of this.outcomeListeners) cb(res.outcomes, res.stats.tick);
    if (res.postings.length > 0) for (const cb of this.postingListeners) cb(res.postings, res.stats.tick);
    return res;
  }

  /** Events of the last step (empty before the first). */
  get events(): readonly SimEvent[] { return this.last?.events ?? []; }
  get lastStep(): StepResult | null { return this.last; }
  /** Subscribes to each step's events; returns an unsubscribe function. */
  onEvents(cb: (events: readonly SimEvent[], tick: number) => void): () => void {
    this.eventListeners.add(cb);
    return () => { this.eventListeners.delete(cb); };
  }
  /** Subscribes to each step's command outcomes (ack / reject); returns an unsubscribe function. */
  onOutcomes(cb: (outcomes: readonly CommandOutcome[], tick: number) => void): () => void {
    this.outcomeListeners.add(cb);
    return () => { this.outcomeListeners.delete(cb); };
  }

  /**
   * Subscribes to each step's ledger postings (only steps that have some). Host-side only: the embedding host keeps
   * the journal (server DB, or the local host's in-memory ledger); postings are never sent to clients.
   */
  onPostings(cb: (postings: readonly LedgerPosting[], tick: number) => void): () => void {
    this.postingListeners.add(cb);
    return () => { this.postingListeners.delete(cb); };
  }

  /** `forClient` drops hidden (server-only) tile layers: use it for every welcome / join (D-38). */
  snapshot(opts: { forClient?: boolean } = {}): Uint8Array { return snapshot(this.state, opts); }
  /** `forClient` drops hidden tile layers: use it for every delta sent to a client (D-38). */
  diffSince(tick: number, opts: { forClient?: boolean } = {}): Uint8Array { return diffSince(this.state, tick, opts); }
  /** Throws `DiffGapError` when this host is not at the diff's `fromTick`. */
  applyDiff(bytes: Uint8Array): void { applyDiff(this.state, bytes); }
  view(): SimView { return view(this.state); }

  /** An independent host with a deep copy of the state and queue, the same pipeline and no listeners. */
  clone(): SimHost {
    const h = new SimHost(this.pipeline);
    h.st = clone(this.state);
    h.queue = [...this.queue];
    return h;
  }
}
