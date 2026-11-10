import { Injectable } from '@nestjs/common';
import { HomeColonyId, type ColonyEliminatedCause } from '@terra/contracts';
import { restore, type PlanetState, type SimEvent } from '@terra/sim';
import type { PlanetEventV1 } from '../../bus/channels';
import { EventBus } from '../../bus/event-bus';
import { CoreException } from '../../core/errors/index';
import { FlagsService } from '../../flags/flags.service';
import { GamePlanets } from '../game-planets.service';
import { HardModeClock, type HardModeMark } from './hard-mode-clock';
import { presenceCommand } from './post';

export interface PresenceSeat {
  readonly planetId: string;
  readonly colonyIndex?: number;
  readonly colonyId?: string;
}

export interface PresenceReply {
  readonly planetId: string;
  readonly colonyId: string;
  readonly colonyIndex: number;
  readonly away: boolean;
  readonly posted: boolean;
  readonly tick: number;
  readonly appliedAtTick?: number;
}

export interface EliminateReply {
  readonly planetId: string;
  readonly colonyId: string;
  readonly colonyIndex: number;
  readonly atTick: number;
  readonly startedAtMs: number;
  readonly cause: ColonyEliminatedCause;
  readonly event: 'colonyEliminated';
}

interface LoadedColony {
  readonly id: string;
  readonly index: number;
  readonly away: boolean;
  readonly tick: number;
}

/** Dev `away` / `back` / `colony eliminate`. Posts module `system.presence`; never a client command. */
@Injectable()
export class DevPresence {
  private readonly tails = new Map<string, Promise<void>>();

  constructor(
    private readonly planets: GamePlanets,
    private readonly clock: HardModeClock,
    private readonly bus: EventBus,
    private readonly flags: FlagsService,
  ) {}

  setAway(input: PresenceSeat & { away: boolean }): Promise<PresenceReply> {
    this.requireWave();
    return this.locked(input, () => this.applyAway(input));
  }

  eliminate(input: PresenceSeat): Promise<EliminateReply> {
    this.requireWave();
    return this.locked(input, () => this.applyEliminate(input));
  }

  private requireWave(): void {
    if (!this.flags.has('W09')) throw new CoreException('WAVE_DISABLED', { status: 403, message: 'wave_disabled' });
  }

  /** Chains on the request seat before any await, so two `away` calls cannot both miss the snapshot. */
  private locked<T>(input: PresenceSeat, fn: () => Promise<T>): Promise<T> {
    const key = `${input.planetId}\0${input.colonyId ?? ''}\0${input.colonyIndex ?? ''}`;
    const prev = this.tails.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    this.tails.set(key, run.then(() => undefined, () => undefined));
    return run;
  }

  private async applyAway(input: PresenceSeat & { away: boolean }): Promise<PresenceReply> {
    const colony = await this.load(input);
    const base = { planetId: input.planetId, colonyId: colony.id, colonyIndex: colony.index, tick: colony.tick };
    if (colony.away === input.away) return { ...base, away: colony.away, posted: false };
    const out = await this.planets.submit(input.planetId, presenceCommand({
      colonyId: colony.id, away: input.away, colonyIndex: colony.index,
    }));
    if (!out.ok) throw new CoreException('PRESENCE_REJECTED', { status: 400, message: out.detail ?? out.code });
    const tick = out.appliedAtTick ?? colony.tick;
    return { ...base, away: input.away, posted: true, tick, appliedAtTick: tick };
  }

  private async applyEliminate(input: PresenceSeat): Promise<EliminateReply> {
    const colony = await this.load(input);
    if (!colony.away) throw new CoreException('NOT_AWAY', { status: 409, message: 'not_away' });
    const mark = this.clock.start(eliminatedMark(input.planetId, colony, Date.now()));
    this.emitEliminated(input.planetId, mark);
    return { ...mark, event: 'colonyEliminated' };
  }

  private emitEliminated(planetId: string, mark: HardModeMark): void {
    const data = { colonyId: mark.colonyId, colonyIndex: mark.colonyIndex, cause: mark.cause, atTick: mark.atTick };
    const event: PlanetEventV1 = {
      planetId, tick: mark.atTick, kind: 'colonyEliminated', severity: 'critical', colonyIds: [mark.colonyId], data,
    };
    this.bus.emit('planet.event', event);
    const sim: SimEvent = { kind: 'colonyEliminated', severity: 'critical', atTick: mark.atTick, colonyIds: [mark.colonyId], data };
    this.planets.fanEvent(planetId, sim);
  }

  private async load(input: PresenceSeat): Promise<LoadedColony> {
    if (!this.planets.isLoaded(input.planetId)) {
      throw new CoreException('NOT_FOUND', { status: 404, message: `Planet "${input.planetId}" is not loaded` });
    }
    const full = await this.planets.fullState(input.planetId);
    const state = restore(full.bytes);
    const colony = findColony(state, input);
    if (!colony) throw new CoreException('NOT_FOUND', { status: 404, message: 'colony not found' });
    const id = HomeColonyId.safeParse(colony.id);
    if (!id.success) throw new CoreException('VALIDATION_ERROR', { status: 400, message: 'colony id is not a home colony id' });
    return { id: id.data, index: colony.index, away: readAway(state, colony.index), tick: full.tick };
  }
}

function eliminatedMark(planetId: string, colony: LoadedColony, startedAtMs: number): HardModeMark {
  return {
    planetId, colonyId: colony.id, colonyIndex: colony.index, startedAtMs, atTick: colony.tick, cause: 'other',
  };
}

function findColony(state: PlanetState, input: PresenceSeat): { id: string; index: number } | undefined {
  if (input.colonyId) {
    const byId = state.colonies.find((colony) => colony?.id === input.colonyId);
    if (byId) {
      if (input.colonyIndex !== undefined && byId.index !== input.colonyIndex) return undefined;
      return { id: byId.id, index: byId.index };
    }
  }
  const index = input.colonyIndex ?? 0;
  const row = state.colonies[index] ?? state.colonies.find((colony) => colony?.index === index);
  if (!row) return undefined;
  const home = input.colonyId;
  // Welcome stores `co_…` (BE-45). The sim row may still be `col_w09`. The command keeps the home id so the digest matches.
  if (home && home.startsWith('co_') && !row.id.startsWith('co_')) return { id: home, index: row.index };
  if (home && home !== row.id) return undefined;
  return { id: row.id, index: row.index };
}

function readAway(state: PlanetState, index: number): boolean {
  const value = state.blobs.presence?.value as { byColony?: Record<string, { away?: boolean }> } | undefined;
  return value?.byColony?.[String(index)]?.away === true;
}
