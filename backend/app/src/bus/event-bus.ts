import { Injectable, Logger } from '@nestjs/common';
import { eventDef, hasEventKind, type EventKind } from '@terra/contracts';
import type { BusChannel, BusChannels, PlanetEventOf } from './channels';

export interface SubscribeOptions<C extends BusChannel> {
  /** Subscribing module name, used in error logs. */
  readonly module: string;
  /** Optional predicate; the handler only runs when it returns true. */
  readonly filter?: (payload: BusChannels[C]) => boolean;
}
export type Unsubscribe = () => void;
type Sub = { module: string; handler: (p: never) => unknown; filter?: (p: never) => boolean };

/**
 * In-process typed event bus. Delivery is SYNCHRONOUS fan-out in subscription order: `emit` returns after every
 * handler ran (async handlers are not awaited; a rejected promise is logged). A throwing handler is logged and
 * skipped, so it never breaks other subscribers or the emitter. Subscribers added/removed during an emit take effect
 * from the next emit. `planet.event` payloads are checked against the event def's zod `data` outside production;
 * an invalid payload makes `emit` throw (before any delivery).
 */
@Injectable()
export class EventBus {
  private readonly log = new Logger('EventBus');
  private readonly subs = new Map<string, Sub[]>();
  private readonly validate = process.env.NODE_ENV !== 'production';

  emit<C extends BusChannel>(channel: C, payload: BusChannels[C]): void {
    if (this.validate && channel === 'planet.event') this.check(payload as BusChannels['planet.event']);
    for (const s of [...(this.subs.get(channel) ?? [])]) {
      try {
        if (s.filter && !s.filter(payload as never)) continue;
        const r = s.handler(payload as never);
        if (r instanceof Promise) r.catch((e: unknown) => this.fail(channel, s.module, e));
      } catch (e) {
        this.fail(channel, s.module, e);
      }
    }
  }

  on<C extends BusChannel>(channel: C, handler: (payload: BusChannels[C]) => unknown, options: SubscribeOptions<C>): Unsubscribe {
    const sub: Sub = { module: options.module, handler: handler as Sub['handler'], filter: options.filter as Sub['filter'] };
    this.subs.set(channel, [...(this.subs.get(channel) ?? []), sub]);
    return () => {
      const list = this.subs.get(channel);
      if (list) this.subs.set(channel, list.filter((x) => x !== sub));
    };
  }

  /** Sugar: subscribe to one event kind of `planet.event`; the handler gets the payload with `data` narrowed. */
  onPlanetEvent<K extends EventKind>(kind: K, handler: (event: PlanetEventOf<K>) => unknown, options: { module: string }): Unsubscribe {
    return this.on('planet.event', (e) => handler(e as PlanetEventOf<K>), {
      module: options.module,
      filter: (e) => e.kind === kind,
    });
  }

  private check(e: BusChannels['planet.event']): void {
    if (!hasEventKind(e.kind)) throw new Error(`planet.event: unknown event kind "${String(e.kind)}"`);
    const r = eventDef(e.kind).data.safeParse(e.data);
    if (!r.success) throw new Error(`planet.event "${e.kind}": invalid data: ${r.error.message}`);
  }

  private fail(channel: string, module: string, e: unknown): void {
    this.log.error(`subscriber of "${channel}" in module "${module}" threw: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  }
}
