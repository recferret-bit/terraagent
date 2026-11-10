import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { SimEvent } from '@terra/sim';
import type { PlanetEventOf } from '../../bus/channels.js';
import { EventBus, type Unsubscribe } from '../../bus/event-bus.js';
import { FlagsService } from '../../flags/flags.service.js';
import { AwayDigestService } from '../../game/digest/service.js';
import { GamePlanets } from '../../game/game-planets.service.js';
import { directorDigestLine } from './digest-line.js';

type TradeEvent = PlanetEventOf<'directorTrade'>;

/**
 * Appends `digest.directorTrade` on the open W09 digest, and fans the same sentence to joined sockets.
 * W09 off, or W15 off, still returns the sentence and still fans it. It does not write a digest row.
 */
@Injectable()
export class DirectorDigestRecorder implements OnModuleInit, OnModuleDestroy {
  private unsub: Unsubscribe | undefined;

  constructor(
    @Inject(EventBus) private readonly bus: EventBus,
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(AwayDigestService) private readonly digests: AwayDigestService,
    @Inject(GamePlanets) private readonly planets: GamePlanets,
  ) {}

  onModuleInit(): void {
    if (this.unsub) return;
    this.unsub = this.bus.onPlanetEvent('directorTrade', (event) => this.record(event), { module: 'DirectorDigest' });
  }

  onModuleDestroy(): void {
    this.unsub?.();
    this.unsub = undefined;
  }

  /** The sentence, or null when the fill is not a line. W09 and W15 choose the digest store. */
  async record(event: TradeEvent): Promise<string | null> {
    const line = directorDigestLine(event.data);
    if (!line) return null;
    this.fan(event, line);
    if (this.flags.has('W09') && this.flags.has('W15')) {
      await this.digests.noteDirectorTrade(event.data.colonyId, line, event.tick);
    }
    return line;
  }

  private fan(event: TradeEvent, line: string): void {
    const sim: SimEvent = {
      kind: 'directorTrade',
      severity: event.severity,
      atTick: event.tick,
      colonyIds: [...event.colonyIds],
      data: { ...event.data, line },
    };
    this.planets.fanEvent(event.planetId, sim);
  }
}
