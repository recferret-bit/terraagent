import type { EventKind, EventKindDef } from '@terra/contracts';
import type { z } from 'zod';

/** Payload of `planet.event` (PROTOCOL §6). A union over kinds, so `data` is narrowed by `kind` from the generated event defs. */
export type PlanetEventOf<K extends EventKind> = {
  readonly planetId: string;
  readonly tick: number;
  readonly kind: K;
  readonly severity: 'info' | 'warn' | 'critical';
  readonly colonyIds: readonly string[];
  readonly data: z.infer<EventKindDef<K>['data']>;
};
export type PlanetEventV1 = { [K in EventKind]: PlanetEventOf<K> }[EventKind];

export interface BatchedTilePreparedEvent {
  readonly planetId: string;
  readonly tick: number;
  readonly kind: 'tilePrepared';
  readonly severity: 'info';
  readonly colonyIds: readonly string[];
  readonly colonyId: string;
  readonly playerId: string;
  readonly count: number;
  readonly q?: number;
  readonly r?: number;
  readonly achievement?: string;
  readonly data: {
    readonly colonyId: string;
    readonly playerId: string;
    readonly count: number;
    readonly q?: number;
    readonly r?: number;
    readonly achievement?: string;
  };
}

export interface BatchedObstacleRemovedEvent {
  readonly planetId: string;
  readonly tick: number;
  readonly kind: 'obstacleRemoved';
  readonly severity: 'info';
  readonly colonyIds: readonly string[];
  readonly colonyId: string;
  readonly playerId: string;
  readonly op: 'clear' | 'break';
  readonly count: number;
  readonly q?: number;
  readonly r?: number;
  readonly achievement?: string;
  readonly data: {
    readonly colonyId: string;
    readonly playerId: string;
    readonly op: 'clear' | 'break';
    readonly count: number;
    readonly q?: number;
    readonly r?: number;
    readonly achievement?: string;
  };
}

export interface BatchedColonyFoundedEvent {
  readonly planetId: string;
  readonly tick: number;
  readonly kind: 'colonyFounded';
  readonly severity: 'info';
  readonly colonyIds: readonly string[];
  readonly colonyId: string;
  readonly playerId: string;
  readonly hubId?: number;
  readonly q?: number;
  readonly r?: number;
  readonly achievement?: string;
  readonly data: {
    readonly colonyId: string;
    readonly playerId: string;
    readonly hubId?: number;
    readonly q?: number;
    readonly r?: number;
    readonly achievement?: string;
  };
}

/**
 * Channel map. A module adds a channel without touching this file via declaration merging:
 *
 *   declare module '../bus/channels' { interface BusChannels { 'near.cargo.settled': CargoSettledV1 } }
 *
 * (the module specifier is the path of this file as seen from the augmenting file, or `'@terra/bus'`-style alias if one is added).
 */
export interface BusChannels {
  'planet.event': PlanetEventV1;
  'tilePrepared': BatchedTilePreparedEvent;
  'progression.tilePrepared': BatchedTilePreparedEvent;
  'obstacleRemoved': BatchedObstacleRemovedEvent;
  'progression.obstacleRemoved': BatchedObstacleRemovedEvent;
  'colonyFounded': BatchedColonyFoundedEvent;
  'progression.colonyFounded': BatchedColonyFoundedEvent;
}
export type BusChannel = keyof BusChannels;
