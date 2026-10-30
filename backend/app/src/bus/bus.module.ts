import { Global, Module } from '@nestjs/common';
import { EventBus } from './event-bus';

export type { BusChannel, BusChannels, PlanetEventOf, PlanetEventV1 } from './channels';
export { EventBus, type SubscribeOptions, type Unsubscribe } from './event-bus';

/** In-process typed event bus (ARCHITECTURE §6). Global: inject `EventBus` anywhere. */
@Global()
@Module({ providers: [EventBus], exports: [EventBus] })
export class BusModule {}
