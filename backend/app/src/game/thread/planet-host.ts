import type { SimCommandV1 } from '@terra/contracts';
import {
  createPlanet, createRegistryPipeline, restore, snapshot, step,
  type Pipeline, type PlanetState, type SimEvent,
} from '@terra/sim';
import type { LoadMsg, Post, PlanetStats, ToThread } from './protocol';

interface Planet {
  state: PlanetState;
  pipeline: Pipeline;
  pending: SimCommandV1[];
  subscribed: boolean;
}

/** Hook for the delta issue: build the binary diff of changes since `fromTick`. Stub: no diff yet, so no `delta` messages. */
export function buildDelta(_state: PlanetState, _fromTick: number): Uint8Array | null {
  return null;
}

/** Exact-size copy so the buffer can be transferred without dragging along unrelated bytes. */
function owned(bytes: Uint8Array): Uint8Array {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
}

/**
 * The planet table of one sim thread and everything that mutates planet state. Runs inside the worker only;
 * the main thread never touches `PlanetState` (SIM-H-01). Transport-agnostic (`post`) so it is unit-testable.
 */
export class PlanetHost {
  readonly planets = new Map<string, Planet>();
  private steps = 0;

  constructor(
    readonly thread: number,
    private readonly flags: readonly string[],
    private readonly post: Post,
  ) {}

  handle(msg: ToThread): void {
    try {
      this.dispatch(msg);
    } catch (e) {
      const planetId = 'planetId' in msg ? msg.planetId : undefined;
      const commandId = msg.t === 'cmd' ? msg.cmd.commandId : undefined;
      this.post({ t: 'error', thread: this.thread, planetId, commandId, message: e instanceof Error ? e.message : String(e) });
      if (msg.t === 'cmd') this.post({ t: 'reject', planetId: msg.planetId, commandId: msg.cmd.commandId, code: 'internal' });
    }
  }

  private dispatch(msg: ToThread): void {
    switch (msg.t) {
      case 'load': return this.load(msg);
      case 'unload':
        this.planets.delete(msg.planetId);
        return this.post({ t: 'unloaded', planetId: msg.planetId });
      case 'cmd': return this.enqueue(msg.planetId, msg.cmd);
      case 'subscribe': case 'unsubscribe': {
        const p = this.planets.get(msg.planetId);
        if (p) p.subscribed = msg.t === 'subscribe';
        return;
      }
      case 'snapshotNow': return this.snapshotNow(msg.planetId);
      case 'ctl': return this.ctl(msg);
    }
  }

  private load(msg: LoadMsg): void {
    const state = msg.snapshot
      ? restore(msg.snapshot)
      : createPlanet({ type: msg.params?.type ?? 'flat', seed: msg.params?.seed ?? msg.planetId, planetId: msg.planetId, radius: msg.params?.radius });
    const pipeline = createRegistryPipeline({ flags: msg.flags ?? this.flags });
    this.planets.set(msg.planetId, { state, pipeline, pending: [], subscribed: false });
    this.post({ t: 'loaded', planetId: msg.planetId, tick: state.meta.tick });
  }

  private enqueue(planetId: string, cmd: SimCommandV1): void {
    const p = this.planets.get(planetId);
    if (!p) return this.post({ t: 'reject', planetId, commandId: cmd.commandId, code: 'planet_not_loaded' });
    p.pending.push(cmd);
  }

  /** Steps one planet by `dt` ticks: applies queued commands, answers them, publishes events and the delta. */
  stepPlanet(planetId: string, dt: number): void {
    const p = this.planets.get(planetId);
    if (!p) return;
    const fromTick = p.state.meta.tick;
    const cmds = p.pending.splice(0);
    const r = step(p.state, cmds, dt, p.pipeline);
    this.steps++;
    for (const o of r.outcomes) {
      if (o.code) this.post({ t: 'reject', planetId, commandId: o.commandId, code: o.code, appliedAtTick: o.appliedAtTick });
      else this.post({ t: 'ack', planetId, commandId: o.commandId, appliedAtTick: o.appliedAtTick });
    }
    if (!p.subscribed) return;
    const diff = buildDelta(p.state, fromTick);
    if (diff) this.post({ t: 'delta', planetId, fromTick, toTick: p.state.meta.tick, diff, events: r.events }, [diff.buffer as ArrayBuffer]);
    else if (r.events.length) this.post({ t: 'event', planetId, events: r.events as SimEvent[] });
  }

  /** PLACEHOLDER scheduling: one `dt = 1` step for every loaded planet. The scheduler issue replaces the caller. */
  stepAll(dt = 1): void {
    for (const id of [...this.planets.keys()]) {
      try { this.stepPlanet(id, dt); } catch (e) {
        this.post({ t: 'error', thread: this.thread, planetId: id, message: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  private snapshotNow(planetId?: string): void {
    for (const id of planetId ? [planetId] : [...this.planets.keys()]) {
      const p = this.planets.get(id);
      if (!p) continue;
      const bytes = owned(snapshot(p.state));
      this.post({ t: 'snapshot', planetId: id, tick: p.state.meta.tick, bytes }, [bytes.buffer as ArrayBuffer]);
    }
  }

  stats(): PlanetStats[] {
    return [...this.planets].map(([planetId, p]) => ({
      planetId, tick: p.state.meta.tick, entities: p.state.entities.count, pendingCmds: p.pending.length, subscribed: p.subscribed,
    }));
  }

  private ctl(msg: Extract<ToThread, { t: 'ctl' }>): void {
    if (msg.op === 'stats') this.post({ t: 'stats', thread: this.thread, reqId: msg.reqId, planets: this.stats(), steps: this.steps });
    else if (msg.op === 'warp') for (let i = 0; i < Math.min(msg.ticks, 100_000); i++) this.stepPlanet(msg.planetId, 1);
    // 'stop' is handled by the thread entry (it owns the port and the timer).
  }
}
