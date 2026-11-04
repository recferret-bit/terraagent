import { Injectable } from '@nestjs/common';
import type { MarketReleaseArgs, MarketReserveArgs, MarketSettledArgs } from '@terra/contracts';
import { EventBus } from '../../bus/event-bus.js';

/** A module command for the planet sim, carried on the bus; `bridgePlanetEvents` submits it with `source: 'near'` (like `near.cargo.settled`). */
export interface NearMarketCommandBusEvent {
  readonly planetId: string;
  readonly colonyId: string;
  readonly colonyIndex: number | null;
  readonly kind: 'market.reserve' | 'market.release' | 'market.settled';
  readonly args: MarketReserveArgs | MarketReleaseArgs | MarketSettledArgs;
}

declare module '../../bus/channels.js' {
  interface BusChannels {
    'near.market.command': NearMarketCommandBusEvent;
  }
}

export interface SimTarget {
  readonly planetId: string;
  readonly colonyId: string;
  readonly colonyIndex: number | null;
}

/** Sends the market module commands (`market.reserve` / `release` / `settled`) to the planet sim. W13-13/15 reuse it. */
@Injectable()
export class MarketSimGateway {
  constructor(private readonly bus: EventBus) {}

  send(t: SimTarget, kind: NearMarketCommandBusEvent['kind'], args: NearMarketCommandBusEvent['args']): void {
    this.bus.emit('near.market.command', { planetId: t.planetId, colonyId: t.colonyId, colonyIndex: t.colonyIndex, kind, args });
  }

  reserve(t: SimTarget, args: Omit<MarketReserveArgs, 'colonyId' | 'colonyIndex'>): void {
    this.send(t, 'market.reserve', { colonyId: t.colonyId, ...(t.colonyIndex !== null ? { colonyIndex: t.colonyIndex } : {}), ...args });
  }

  release(t: SimTarget, args: Omit<MarketReleaseArgs, 'colonyId' | 'colonyIndex'>): void {
    this.send(t, 'market.release', { colonyId: t.colonyId, ...(t.colonyIndex !== null ? { colonyIndex: t.colonyIndex } : {}), ...args });
  }
}
