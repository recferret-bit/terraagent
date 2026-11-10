import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { DeedMetadataV1 } from '@terra/contracts';
import type { PlanetEventV1 } from '../../bus/channels.js';
import { EventBus } from '../../bus/event-bus.js';
import { FlagsService } from '../../flags/flags.service.js';
import { DeedDebounceService, type FlushedDeedUpdate } from './deed-debounce.service.js';
import { DeedProjectorService } from './deed-projector.service.js';
import { DeedRepository, type StoredDeedRecord } from './deed.repository.js';
import {
  extractEventColonyId,
  resolveTargetDeedRecord,
} from './parts/deed-event-helpers.js';

export interface DeedTerminateBusEvent {
  readonly colonyId: string;
  readonly planetId?: string;
  readonly status: 'eliminated' | 'abandoned';
  readonly reason?: string;
}

declare module '../../bus/channels.js' {
  interface BusChannels {
    'near.deed.terminate': DeedTerminateBusEvent;
  }
}

/**
 * Handles terminal non-settled Colony Deed transitions (`eliminated` or `abandoned`),
 * forcing the final metadata update immediately past the 10-minute debounce window (W20-14, SIM §7.7).
 */
@Injectable()
export class DeedLifecycleService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(DeedLifecycleService.name);
  private readonly stops: Array<() => void> = [];

  constructor(
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(DeedRepository) private readonly deeds: DeedRepository,
    @Inject(DeedProjectorService) private readonly projector: DeedProjectorService,
    @Inject(DeedDebounceService) private readonly debounce: DeedDebounceService,
    @Optional() @Inject(EventBus) private readonly bus?: EventBus,
  ) {}

  onModuleInit(): void {
    if (this.stops.length > 0 || !this.bus) return;
    this.stops.push(
      this.bus.on('planet.event', (ev) => this.onPlanetEvent(ev), {
        module: 'DeedLifecycleService',
      }),
      this.bus.on('near.deed.terminate', (ev) => {
        void this.markTerminalStatus(ev).catch((err: unknown) => {
          this.log.warn(
            `deed terminate failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }, { module: 'DeedLifecycleService' }),
    );
  }

  onModuleDestroy(): void {
    for (const stop of this.stops.splice(0)) stop();
  }

  private onPlanetEvent(event: PlanetEventV1 | { planetId: string; kind: string; colonyIds?: readonly string[]; data: Record<string, unknown> }): void {
    if (!this.flags.has('W20')) return;
    void this.handleEvent(event).catch((err: unknown) => {
      this.log.warn(
        `deed lifecycle event handling failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  async handleEvent(
    event: { planetId: string; kind: string; colonyIds?: readonly string[]; data: Record<string, unknown> },
  ): Promise<DeedMetadataV1 | null> {
    if (!this.flags.has('W20')) return null;
    const data = (event.data ?? {}) as Record<string, unknown>;
    const colonyId = this.extractColonyId(event, data);
    if (!colonyId) return null;

    if (event.kind === 'colonyEliminated') {
      if (!this.flags.has('W18')) return null;
      return this.markTerminalStatus({
        colonyId,
        planetId: event.planetId,
        status: 'eliminated',
        reason: 'Colony eliminated — Final Deed',
      });
    }

    if (event.kind === 'colonyAbandoned' || event.kind === 'colonyDeparted') {
      if (data.settled === true) return null;
      return this.markTerminalStatus({
        colonyId,
        planetId: event.planetId,
        status: 'abandoned',
        reason: 'Colony abandoned — Final Deed',
      });
    }

    if (
      event.kind === 'buildingDestroyed' &&
      (data.building === 'hub' || data.building === 'commandHub' || data.colonyEliminated === true)
    ) {
      const terminalStatus = this.flags.has('W18') ? 'eliminated' : 'abandoned';
      return this.markTerminalStatus({
        colonyId,
        planetId: event.planetId,
        status: terminalStatus,
        reason:
          terminalStatus === 'eliminated'
            ? 'Command Hub destroyed — Colony eliminated'
            : 'Command Hub lost — Colony abandoned',
      });
    }

    return null;
  }

  async markTerminalStatus(input: {
    colonyId: string;
    planetId?: string;
    status: 'eliminated' | 'abandoned';
    reason?: string;
  }): Promise<DeedMetadataV1 | null> {
    if (!this.flags.has('W20')) return null;
    const record = await this.resolveDeed(input.colonyId, input.planetId);
    if (!record) return null;
    // A Settled Deed is immutable in status; elimination/abandonment only applies before settlement.
    if (record.settled) return null;
    if (record.status === input.status) return record.metadata;

    const change =
      input.reason ??
      (input.status === 'eliminated'
        ? 'Colony eliminated — Final Deed'
        : 'Colony abandoned — Final Deed');

    const projected = await this.projector.projectMilestone({
      colonyId: record.colonyId,
      planetId: record.planetId,
      status: input.status,
      change,
      forceImmediate: true,
    });
    // Ensure immediate flush even if no listener was wired
    const pending = this.projector.getQueuedMilestone(record.colonyId);
    if (pending) {
      const flushed: FlushedDeedUpdate | null = await this.debounce.flushColony(record.colonyId, {
        forceImmediate: true,
      });
      return flushed?.metadata ?? projected;
    }
    return projected;
  }

  private extractColonyId(
    event: { colonyIds?: readonly string[] },
    data: Record<string, unknown>,
  ): string | null {
    return extractEventColonyId(event, data);
  }

  private async resolveDeed(
    colonyId: string,
    planetId?: string,
  ): Promise<StoredDeedRecord | null> {
    return resolveTargetDeedRecord(this.deeds, colonyId, planetId);
  }
}
