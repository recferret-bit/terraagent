import { HomeColonyId, newId, type SimCommandV1 } from '@terra/contracts';
import type { PlanetState, SimCommand, SimEvent } from '@terra/sim';

/** Page-local hard-mode clock for `?host=local`. The server clock W09-19 reads is `HardModeClock`. */
export interface LocalHardModeMark {
  readonly planetId: string;
  readonly colonyId: string;
  readonly colonyIndex: number;
  readonly startedAtMs: number;
  readonly atTick: number;
  readonly cause: 'other';
}

const keyOf = (planetId: string, colonyId: string): string => `${planetId}\0${colonyId}`;

export class LocalHardModeClock {
  private readonly marks = new Map<string, LocalHardModeMark>();

  start(mark: LocalHardModeMark): LocalHardModeMark {
    const key = keyOf(mark.planetId, mark.colonyId);
    const prev = this.marks.get(key);
    if (prev) return prev;
    this.marks.set(key, mark);
    return mark;
  }

  get(planetId: string, colonyId: string): LocalHardModeMark | undefined {
    return this.marks.get(keyOf(planetId, colonyId));
  }
}

export interface LocalPresenceInput {
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly waves: readonly string[];
  readonly state: PlanetState;
  readonly tick: number;
  readonly nowMs: number;
  readonly queued: readonly SimCommand[];
  readonly clock: LocalHardModeClock;
}

export type LocalPresencePlan =
  | { readonly ok: false; readonly code: string; readonly message: string }
  | {
      readonly ok: true;
      readonly reply: Record<string, unknown>;
      readonly command?: SimCommand;
      readonly step: boolean;
      readonly expectAway?: boolean;
      readonly colonyIndex: number;
      readonly event?: SimEvent;
    };

interface Seat {
  readonly id: string;
  readonly index: number;
}

/** Pure plan for the in-process host. Does not step. A repeat `away` adds no command. */
export function planLocalPresence(input: LocalPresenceInput): LocalPresencePlan {
  if (!input.waves.includes('W09')) return { ok: false, code: 'wave_disabled', message: 'wave_disabled' };
  const colony = findColony(input.state, input.args);
  if (!colony) return { ok: false, code: 'not_found', message: 'colony not found' };
  if (!HomeColonyId.safeParse(colony.id).success) return { ok: false, code: 'invalid_args', message: 'colony id is not a home colony id' };
  const away = effectiveAway(input.state, input.queued, colony);
  if (input.name === 'away' || input.name === 'back') return planFlip(input, colony, away, input.name === 'away');
  if (input.name === 'colony.eliminate') return planEliminate(input, colony, away);
  return { ok: false, code: 'invalid_args', message: `unknown presence command "${input.name}"` };
}

export function colonyPresenceAway(state: PlanetState, index: number): boolean {
  const value = state.blobs.presence?.value as { byColony?: Record<string, { away?: boolean }> } | undefined;
  return value?.byColony?.[String(index)]?.away === true;
}

function planFlip(input: LocalPresenceInput, colony: Seat, away: boolean, next: boolean): LocalPresencePlan {
  const planetId = input.state.meta.planetId;
  const base = { planetId, colonyId: colony.id, colonyIndex: colony.index, away: next, tick: input.tick };
  if (away === next) return { ok: true, reply: { ...base, posted: false }, step: false, colonyIndex: colony.index };
  return {
    ok: true,
    reply: { ...base, posted: true, appliedAtTick: input.tick },
    command: presenceCmd(colony, next),
    step: true,
    expectAway: next,
    colonyIndex: colony.index,
  };
}

function planEliminate(input: LocalPresenceInput, colony: Seat, away: boolean): LocalPresencePlan {
  if (!away) return { ok: false, code: 'not_away', message: 'not_away' };
  const planetId = input.state.meta.planetId;
  const mark = input.clock.start({
    planetId, colonyId: colony.id, colonyIndex: colony.index, startedAtMs: input.nowMs, atTick: input.tick, cause: 'other',
  });
  const data = { colonyId: colony.id, colonyIndex: colony.index, cause: 'other' as const, atTick: input.tick };
  return {
    ok: true,
    step: false,
    colonyIndex: colony.index,
    reply: { planetId, colonyId: colony.id, colonyIndex: colony.index, atTick: input.tick, startedAtMs: mark.startedAtMs, cause: 'other', event: 'colonyEliminated' },
    event: { kind: 'colonyEliminated', severity: 'critical', atTick: input.tick, colonyIds: [colony.id], data },
  };
}

function presenceCmd(colony: Seat, away: boolean): SimCommandV1 {
  return {
    colonyIndex: colony.index,
    source: 'system',
    commandId: newId('cm'),
    kind: 'system.presence',
    args: { colonyId: colony.id, away },
  };
}

function findColony(state: PlanetState, args: Record<string, unknown>): Seat | undefined {
  const colonyId = typeof args.colonyId === 'string' && args.colonyId.length > 0 ? args.colonyId : undefined;
  const colonyIndex = typeof args.colonyIndex === 'number' && Number.isInteger(args.colonyIndex) && args.colonyIndex >= 0 ? args.colonyIndex : undefined;
  if (colonyId) {
    const byId = state.colonies.find((colony) => colony?.id === colonyId);
    if (!byId || (colonyIndex !== undefined && byId.index !== colonyIndex)) return undefined;
    return { id: byId.id, index: byId.index };
  }
  const index = colonyIndex ?? 0;
  const row = state.colonies[index] ?? state.colonies.find((colony) => colony?.index === index);
  return row ? { id: row.id, index: row.index } : undefined;
}

function effectiveAway(state: PlanetState, queued: readonly SimCommand[], colony: Seat): boolean {
  let pending: boolean | undefined;
  for (const cmd of queued) {
    if (cmd.kind !== 'system.presence' || !cmd.args || typeof cmd.args !== 'object') continue;
    const args = cmd.args as { colonyId?: unknown; away?: unknown };
    if (args.colonyId === colony.id && typeof args.away === 'boolean') pending = args.away;
  }
  return pending ?? colonyPresenceAway(state, colony.index);
}
