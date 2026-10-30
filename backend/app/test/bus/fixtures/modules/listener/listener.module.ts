import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { EventBus, type PlanetEventOf } from '../../../../../src/bus/bus.module';

@Injectable()
export class Listener implements OnModuleInit {
  readonly received: PlanetEventOf<'dev.pong'>[] = [];
  constructor(readonly bus: EventBus) {}
  onModuleInit() {
    this.bus.onPlanetEvent('dev.pong', (e) => {
      const note: string | undefined = e.data.note; // compile-time: data narrowed by kind
      void note;
      this.received.push(e);
    }, { module: 'listener' });
  }
}

@Module({ providers: [Listener], exports: [Listener] })
export class ListenerModule {}
