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

/**
 * Channel map. A module adds a channel without touching this file via declaration merging:
 *
 *   declare module '../bus/channels' { interface BusChannels { 'near.cargo.settled': CargoSettledV1 } }
 *
 * (the module specifier is the path of this file as seen from the augmenting file, or `'@terra/bus'`-style alias if one is added).
 */
export interface BusChannels {
  'planet.event': PlanetEventV1;
}
export type BusChannel = keyof BusChannels;
