import { Injectable, Module } from '@nestjs/common';
import { EventBus } from '../../../../../src/bus/bus.module';

/** Stands in for the game module. */
@Injectable()
export class Emitter {
  constructor(readonly bus: EventBus) {}
  pong(note?: string) {
    this.bus.emit('planet.event', { planetId: 'p1', tick: 7, kind: 'dev.pong', severity: 'info', colonyIds: ['c1'], data: { note } });
  }
}

@Module({ providers: [Emitter], exports: [Emitter] })
export class EmitterModule {}
