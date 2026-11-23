import type { SimCommandV1 } from '@terra/contracts';
import type { FromThread, PlanetCarry, ToThread } from '../thread/protocol';
import type { PlacementTable } from './placement-table';

/** What the mover needs from the pool. */
export interface MoverPort {
  send(thread: number, msg: ToThread, transfer?: ArrayBuffer[]): boolean;
  /** Fans a pool-made message out to the pool's listeners as if `thread` posted it. */
  emit(thread: number, msg: FromThread): void;
}

interface Move {
  readonly planetId: string;
  readonly from: number;
  to: number;
  phase: 'handoff' | 'loading';
  /** Messages routed to the planet while it moves, replayed in order on the new thread. */
  readonly buffer: { msg: ToThread; transfer: ArrayBuffer[] }[];
  /** Route state at the start (subscription, mode, warp): carried in the target `load` (`moved`), before its first step. */
  readonly subscribed: boolean;
  readonly mode?: 'active' | 'coarse';
  readonly warp?: number;
  pending: readonly SimCommandV1[];
  carry?: PlanetCarry;
  /** Copy of the handoff snapshot, so a failed load on the target can go back to the source. */
  fallback?: Uint8Array;
  tick: number;
}

/**
 * Moves one planet between sim threads (3.2) below `GamePlanets`, so the lease, ledger and snapshot listeners never see
 * an unload or a load: `unload { handoff }` on the source (snapshot + removal in one dispatch, no step in between),
 * `load` of that snapshot with the original flags / overrides and its subscription, mode and warp on the target, then
 * the commands it had queued and everything sent to it meanwhile, in order. The delta stream continues from the handoff
 * tick; the pool's listeners get `moved` (the WS layer resyncs its clients). A failed target load goes back to the source.
 */
export class PlanetMover {
  private readonly moves = new Map<string, Move>();
  /** Moves finished (`moved` emitted). */
  completed = 0;

  constructor(private readonly table: PlacementTable, private readonly port: MoverPort) {}

  isMoving(planetId: string): boolean {
    return this.moves.has(planetId);
  }

  /** Starts moving a placed, loaded planet to `to`; false when it cannot (unknown, same thread, source down). */
  start(planetId: string, to: number): boolean {
    const p = this.table.get(planetId);
    if (!p || this.moves.has(planetId) || p.thread === to) return false;
    const move: Move = {
      planetId, from: p.thread, to, phase: 'handoff', buffer: [], subscribed: p.subscribed, mode: p.mode, warp: p.warp, pending: [], tick: -1,
    };
    if (!this.port.send(p.thread, { t: 'unload', planetId, handoff: true })) return false;
    this.moves.set(planetId, move);
    return true;
  }

  /** Holds a message for a moving planet; false when the planet is not moving (route it normally). */
  buffer(planetId: string, msg: ToThread, transfer: ArrayBuffer[]): boolean {
    const m = this.moves.get(planetId);
    if (!m) return false;
    m.buffer.push({ msg, transfer });
    return true;
  }

  /** Handles the thread messages of a move; true = consumed (not for the pool's listeners). */
  intercept(thread: number, msg: FromThread): boolean {
    if (msg.t === 'handedOff') return this.onHandedOff(thread, msg), true;
    const m = 'planetId' in msg && msg.planetId ? this.moves.get(msg.planetId) : undefined;
    if (!m || m.phase !== 'loading' || thread !== m.to) return false;
    if (msg.t === 'loaded') return this.finish(m), true;
    if (msg.t === 'error') return this.fallBack(m), true;
    return false;
  }

  /** A thread died: moves that depended on it end (the planet is down; `GamePlanets` answers its waiters). */
  threadDown(thread: number): void {
    for (const m of [...this.moves.values()]) {
      if ((m.phase === 'handoff' && m.from === thread) || (m.phase === 'loading' && m.to === thread)) this.moves.delete(m.planetId);
    }
  }

  private onHandedOff(thread: number, msg: Extract<FromThread, { t: 'handedOff' }>): void {
    const m = this.moves.get(msg.planetId);
    if (!m || thread !== m.from) return;
    if (!msg.bytes) return this.abort(m); // it was not on the source after all
    m.pending = msg.pending;
    m.carry = msg.carry;
    m.tick = msg.tick;
    m.fallback = msg.bytes.slice();
    m.phase = 'loading';
    if (!this.load(m, m.to, msg.bytes)) this.fallBack(m);
  }

  private load(m: Move, thread: number, bytes: Uint8Array): boolean {
    const p = this.table.get(m.planetId);
    this.table.setThread(m.planetId, thread);
    m.to = thread;
    const moved = { subscribed: m.subscribed, ...(m.mode ? { mode: m.mode } : {}), ...(m.warp !== undefined ? { warp: m.warp } : {}), ...(m.carry ? { carry: m.carry } : {}) };
    const msg: ToThread = {
      t: 'load', planetId: m.planetId, snapshot: bytes, moved, ...(p?.flags ? { flags: p.flags } : {}), ...(p?.overrides ? { overrides: p.overrides } : {}),
    };
    return this.port.send(thread, msg, [bytes.buffer as ArrayBuffer]);
  }

  /** The target refused or is gone: the planet goes back to its source thread from the handoff snapshot. */
  private fallBack(m: Move): void {
    const bytes = m.fallback;
    m.fallback = undefined;
    if (!bytes || m.to === m.from || !this.load(m, m.from, bytes)) this.moves.delete(m.planetId);
  }

  private abort(m: Move): void {
    this.moves.delete(m.planetId);
    for (const b of m.buffer) this.port.send(this.table.threadOf(m.planetId), b.msg, b.transfer);
  }

  private finish(m: Move): void {
    this.moves.delete(m.planetId);
    const send = (msg: ToThread, transfer: ArrayBuffer[] = []) => this.port.send(m.to, msg, transfer);
    const id = m.planetId;
    for (const cmd of m.pending) send({ t: 'cmd', planetId: id, cmd });
    for (const b of m.buffer) send(b.msg, b.transfer);
    this.completed++;
    this.port.emit(m.to, { t: 'moved', planetId: id, from: m.from, to: m.to, tick: m.tick });
  }
}
