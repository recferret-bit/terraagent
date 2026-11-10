import { Injectable } from '@nestjs/common';
import { GuildArrivedPayload, GuildDepartedPayload } from '@terra/contracts';
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

/** Builds `guild.arrived` / `guild.departed` and pushes them on the same bus as `director.status`. Offers stay empty (W15-11). */
@Injectable()
export class GuildVisitPublisher {
  constructor(private readonly bus: EventBus) {}

  arrived(input: ArrivedInput): GuildPush {
    const payload = GuildArrivedPayload.parse({ ...input, offers: [] });
    this.bus.emit('guild.arrived', { planetId: payload.planetId, payload });
    return { t: 'guild.arrived', d: payload };
  }

  departed(input: DepartedInput): GuildPush {
    const payload = GuildDepartedPayload.parse(input);
    this.bus.emit('guild.departed', { planetId: payload.planetId, payload });
    return { t: 'guild.departed', d: payload };
  }
}
