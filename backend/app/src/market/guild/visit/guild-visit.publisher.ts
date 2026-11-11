import { Inject, Injectable, Optional } from '@nestjs/common';
import { GuildArrivedPayload, GuildDepartedPayload, type GuildOffer } from '@terra/contracts';
import { EventBus } from '../../../bus/event-bus.js';

export interface GuildArrivedBusEvent {
  readonly planetId: string;
  readonly payload: GuildArrivedPayload;
}

export interface GuildDepartedBusEvent {
  readonly planetId: string;
  readonly payload: GuildDepartedPayload;
}

declare module '../../../bus/channels.js' {
  interface BusChannels {
    'guild.arrived': GuildArrivedBusEvent;
    'guild.departed': GuildDepartedBusEvent;
  }
}

export interface GuildPush {
  readonly t: 'guild.arrived' | 'guild.departed';
  readonly d: GuildArrivedPayload | GuildDepartedPayload;
}

export interface ArrivedInput {
  readonly shipId: string;
  readonly planetId: string;
  readonly npcId: string;
  readonly name: string;
  readonly departAt: number;
}

export interface DepartedInput {
  readonly shipId: string;
  readonly planetId: string;
  readonly npcId: string;
}

/** Resting NPC quotes for one dock, already capped at 6. Absent in tests that do not place quotes. */
export interface GuildOfferSource {
  offersFor(input: ArrivedInput): Promise<GuildOffer[]>;
}

export const GUILD_OFFER_SOURCE = Symbol('GUILD_OFFER_SOURCE');

/** Builds `guild.arrived` / `guild.departed` and pushes them on the same bus as `director.status`. */
@Injectable()
export class GuildVisitPublisher {
  constructor(
    private readonly bus: EventBus,
    @Optional() @Inject(GUILD_OFFER_SOURCE) private readonly offers?: GuildOfferSource,
  ) {}

  async arrived(input: ArrivedInput): Promise<GuildPush> {
    const listed = this.offers ? await this.offers.offersFor(input) : [];
    const payload = GuildArrivedPayload.parse({ ...input, offers: listed });
    this.bus.emit('guild.arrived', { planetId: payload.planetId, payload });
    return { t: 'guild.arrived', d: payload };
  }

  departed(input: DepartedInput): GuildPush {
    const payload = GuildDepartedPayload.parse(input);
    this.bus.emit('guild.departed', { planetId: payload.planetId, payload });
    return { t: 'guild.departed', d: payload };
  }
}
