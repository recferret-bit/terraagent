import { setBlob, type PlanetState } from '../kernel/state';
import type { UnitCommand } from './types';

/** One unit's command state in `state.blobs.units` (plain data; keyed by entity id). */
export interface UnitRecord {
  /** The command being executed, or `null` when idle. */
  current: UnitCommand | null;
  /** Commands to run after `current` (player shift-queue). */
  queue: UnitCommand[];
  /** Work providers are not asked before this tick (set by `stop`). */
  holdUntil: number;
  /** Auto work whose route failed, by command key → tick until which it is skipped. */
  skip: Record<string, number>;
  /** Consecutive failures per auto command key: each one doubles the skip (back-off, GP-21); cleared on success. */
  fails?: Record<string, number>;
  /** The last player command that failed (e.g. its target was unreachable), or `null`. Clients toast it once per `tick`. */
  lastFailure: UnitFailure | null;
}

export interface UnitFailure {
  code: 'no_path';
  /** Tick the command failed on. */
  tick: number;
  kind: UnitCommand['kind'];
  source: UnitCommand['source'];
}

interface UnitsBlobValue {
  byId: Record<string, UnitRecord>;
}

const emptyRecord = (): UnitRecord => ({ current: null, queue: [], holdUntil: 0, skip: {}, lastFailure: null });

/**
 * Read/write access to `state.blobs.units` for one step. Records are edited in place; `flush` stamps the blob once
 * if anything changed, so an idle planet sends no unit-command delta.
 */
export class UnitBook {
  private readonly value: UnitsBlobValue & Record<string, unknown>;
  private dirty = false;
  private stampDirty = false;

  constructor(private readonly state: PlanetState) {
    const raw = state.blobs.units?.value as (UnitsBlobValue & Record<string, unknown>) | undefined;
    if (raw && typeof raw === 'object') {
      if (!raw.byId) raw.byId = {};
      this.value = raw;
    } else {
      this.value = { byId: {} };
    }
  }

  /** The record of `id`, created empty on first use. */
  get(id: number): UnitRecord {
    const key = String(id);
    let rec = this.value.byId[key];
    if (!rec) {
      rec = emptyRecord();
      this.value.byId[key] = rec;
      this.dirty = true;
    }
    rec.queue ??= [];
    rec.skip ??= {};
    return rec;
  }

  peek(id: number): UnitRecord | null {
    return this.value.byId[String(id)] ?? null;
  }

  ids(): number[] {
    return Object.keys(this.value.byId).map(Number).sort((a, b) => a - b);
  }

  remove(id: number, stamp = false): void {
    if (this.value.byId[String(id)]) {
      delete this.value.byId[String(id)];
      this.dirty = true;
      if (stamp) this.stampDirty = true;
    }
  }

  touch(stamp = true): void {
    this.dirty = true;
    if (stamp) this.stampDirty = true;
  }

  flush(tick: number): void {
    if (!this.dirty) return;
    const latest = this.state.blobs.units?.value as Record<string, unknown> | undefined;
    if (latest && typeof latest === 'object' && latest !== this.value) {
      for (const [k, v] of Object.entries(latest)) {
        if (k !== 'byId') this.value[k] = v;
      }
    }
    if (this.stampDirty || !this.state.blobs.units) {
      setBlob(this.state, 'units', this.value, tick);
    } else {
      this.state.blobs.units.value = this.value;
    }
    this.dirty = false;
    this.stampDirty = false;
  }
}

/** The current command of entity `id` (read-only view for tests, HUDs and other systems). */
export function getUnitCommand(state: PlanetState, id: number): UnitCommand | null {
  return new UnitBook(state).peek(id)?.current ?? null;
}

/** The full command record of entity `id`, or `null` if it never received a command. */
export function getUnitRecord(state: PlanetState, id: number): UnitRecord | null {
  return new UnitBook(state).peek(id);
}
