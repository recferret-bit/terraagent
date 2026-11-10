import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { deedSettleOpId, type DeedView } from '@terra/contracts';
import type { PlanetEventV1 } from '../../bus/channels.js';
import { EventBus } from '../../bus/event-bus.js';
import { CoreException } from '../../core/errors/index.js';
import { FlagsService } from '../../flags/flags.service.js';
import { NotifierPort } from '../../ports/notifier.port.js';
import type { ClaimedRow } from '../application/outbox/chain-outbox.repository.js';
import { OutboxListeners } from '../application/outbox/outbox-listeners.js';
import { DeedDebounceService } from './deed-debounce.service.js';
import { DeedImageRendererService } from './deed-image.renderer.js';
import { DeedMintOutboxService } from './deed-mint-outbox.service.js';
import { DeedProjectorService } from './deed-projector.service.js';
import { DeedRepository, type StoredDeedRecord } from './deed.repository.js';

/**
 * Settled Deed transition hook (`W20-15`, `NEAR-92`, `D-18`):
 * Triggers on reaching Stage 4 + 100% Living Planet (`stage >= 4 && terraformBp >= 10_000`),
 * `colonySettled` event, the UI "Seal Settled Deed" action, or `deed.settle <colony>` dev command.
 * Dispatches `DeedNft.updateMetadata` with `settled: true` (`opId = deed-settle:{colonyId}`) bypassing
 * the 10-min debounce, re-renders the gold card image, and emits W12 `settler` progression facts.
 */
@Injectable()
export class DeedSettledService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(DeedSettledService.name);
  private readonly stops: Array<() => void> = [];
  private readonly settlingColonies = new Set<string>();
  private readonly notifiedSettledColonies = new Set<string>();

  constructor(
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(DeedRepository) private readonly deeds: DeedRepository,
    @Inject(DeedProjectorService) private readonly projector: DeedProjectorService,
    @Inject(DeedDebounceService) private readonly debounce: DeedDebounceService,
    @Inject(DeedMintOutboxService) private readonly mintService: DeedMintOutboxService,
    @Optional() @Inject(DeedImageRendererService) private readonly imageRenderer?: DeedImageRendererService,
    @Optional() @Inject(EventBus) private readonly bus?: EventBus,
    @Optional() @Inject(OutboxListeners) private readonly listeners?: OutboxListeners,
    @Optional() @Inject(NotifierPort) private readonly notifier?: NotifierPort,
  ) {}

  onModuleInit(): void {
    if (this.stops.length > 0) return;
    this.stops.push(
      this.projector.onMilestoneQueued((colonyId, patch, nextMeta) => {
        if (
          !patch.settled &&
          nextMeta.status === 'active' &&
          (nextMeta.stage ?? 0) >= 4 &&
          (nextMeta.terraformBp ?? 0) >= 10_000
        ) {
          void this.settleColonyDeed({
            colonyId,
            planetId: nextMeta.planet,
            reason: 'Stage 4 + 100% Living Planet reached — Settled Deed sealed',
          }).catch((err: unknown) => {
            this.log.warn(
              `auto-settle deed failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        }
      }),
    );
    if (this.bus) {
      this.stops.push(
        this.bus.on('planet.event', (ev) => this.onPlanetEvent(ev), {
          module: 'DeedSettledService',
        }),
      );
    }
    if (this.listeners) {
      this.stops.push(
        this.listeners.onDone((row, res, txHash) => this.onOutboxRowDone(row, res, txHash)),
      );
    }
  }

  onModuleDestroy(): void {
    for (const stop of this.stops.splice(0)) stop();
  }

  private onPlanetEvent(
    event: PlanetEventV1 | { planetId: string; kind: string; colonyIds?: readonly string[]; data: Record<string, unknown> },
  ): void {
    if (!this.flags.has('W20')) return;
    if (event.kind !== 'colonySettled') return;
    const data = (event.data ?? {}) as Record<string, unknown>;
    const colonyId =
      typeof data.colonyId === 'string' && data.colonyId.length > 0
        ? data.colonyId
        : typeof event.colonyIds?.[0] === 'string'
          ? event.colonyIds[0]
          : 'col_0';

    void this.settleColonyDeed({
      colonyId,
      planetId: event.planetId,
      reason: 'Colony settled — Gold Deed sealed',
    }).catch((err: unknown) => {
      this.log.warn(
        `colonySettled deed hook failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  async settleColonyDeed(input: {
    colonyId?: string;
    planetId?: string;
    reason?: string;
  }): Promise<DeedView> {
    if (!this.flags.has('W20')) {
      throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    }
    const record = await this.resolveDeed(input.colonyId, input.planetId);
    if (!record) {
      throw new CoreException('DEED_NOT_FOUND', { status: 404, message: 'Colony Deed not found' });
    }
    if (record.settled) {
      return this.deeds.toDeedView(record);
    }
    if (record.status === 'eliminated' || record.status === 'abandoned') {
      throw new CoreException('DEED_NOT_SETTLED', {
        status: 409,
        message: 'Cannot settle an eliminated or abandoned colony deed',
      });
    }
    if (this.settlingColonies.has(record.colonyId)) {
      return this.deeds.toDeedView(record);
    }

    this.settlingColonies.add(record.colonyId);
    try {
      const opId = deedSettleOpId(record.colonyId);
      const change = input.reason ?? 'Colony settled — Gold Deed sealed';
      await this.projector.projectMilestone({
        colonyId: record.colonyId,
        planetId: record.planetId,
        status: 'settled',
        settled: true,
        ...(this.flags.has('W08')
          ? { stage: Math.max(record.metadata.stage ?? 4, 4) }
          : {}),
        ...(this.flags.has('W05')
          ? { terraformBp: Math.max(record.metadata.terraformBp ?? 10_000, 10_000) }
          : {}),
        change,
        forceImmediate: true,
      });

      const pending = this.projector.getQueuedMilestone(record.colonyId);
      if (pending) {
        await this.debounce.flushColony(record.colonyId, {
          forceImmediate: true,
          opIdOverride: opId,
        });
      }

      const updated = (await this.deeds.findByColonyId(record.colonyId)) ?? record;
      this.imageRenderer?.invalidate(updated.tokenId);
      if (this.imageRenderer) {
        await this.imageRenderer.renderForToken(updated.tokenId);
      }

      // Emit immediate WS push so UI switches to Gold Settled variant right away
      await this.mintService.pushDeedUpdated(updated, change, updated.lastUpdateTx);
      await this.emitSettledProgressionFact(updated);
      await this.notifySettledIfEnabled(updated, change);

      return this.deeds.toDeedView(updated);
    } finally {
      this.settlingColonies.delete(record.colonyId);
    }
  }

  private async onOutboxRowDone(
    row: ClaimedRow,
    _result: object,
    txHash: string | null,
  ): Promise<void> {
    if (row.port !== 'DeedNft' || row.method !== 'updateMetadata') return;
    if (!row.opId.startsWith('deed-settle:')) return;
    const colonyId =
      typeof row.payload.colonyId === 'string' && row.payload.colonyId.length > 0
        ? row.payload.colonyId
        : row.opId.slice('deed-settle:'.length);
    if (!colonyId) return;

    const updated = await this.deeds.findByColonyId(colonyId);
    if (!updated) return;

    this.imageRenderer?.invalidate(updated.tokenId);
    if (this.imageRenderer) {
      await this.imageRenderer.renderForToken(updated.tokenId);
    }

    if (this.bus && this.flags.has('W20')) {
      this.bus.emit('planet.event', {
        planetId: updated.planetId,
        tick: 0,
        kind: 'deedSettled',
        severity: 'info',
        colonyIds: [updated.colonyId],
        data: {
          colonyId: updated.colonyId,
          planetId: updated.planetId,
          tokenId: updated.tokenId,
          version: updated.metadataVersion,
          ...(txHash || updated.lastUpdateTx
            ? { txHash: (txHash ?? updated.lastUpdateTx)! }
            : {}),
          imageUrl: updated.metadata.imageUrl,
        },
      });
    }
    await this.emitSettledProgressionFact(updated);
    await this.notifySettledIfEnabled(updated, 'Colony settled — Gold Deed sealed');
  }

  /**
   * W20-25: Push / Telegram notification via `NotifierPort` (W09) is sent ONLY on deed settled.
   * When W09 is off or `NotifierPort` is unbound, skips silently without error.
   */
  private async notifySettledIfEnabled(record: StoredDeedRecord, change: string): Promise<void> {
    if (!this.flags.has('W20') || !this.flags.has('W09') || !this.notifier) return;
    if (this.notifiedSettledColonies.has(record.colonyId)) return;
    this.notifiedSettledColonies.add(record.colonyId);
    try {
      const to = record.playerId ?? record.accountId;
      if (!to) return;
      await this.notifier.send({
        colonyId: record.colonyId,
        eventId: `deed-settled:${record.colonyId}`,
        kind: 'deed_settled',
        channel: 'telegram',
        to,
        title: 'Colony Deed Settled',
        body: `Your Colony Deed (${record.tokenId}) was settled: ${change}`,
        data: {
          colonyId: record.colonyId,
          planetId: record.planetId,
          tokenId: record.tokenId,
          version: record.metadataVersion,
          settled: true,
        },
      });
    } catch (err: unknown) {
      this.log.warn(
        `deed settled notify failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async emitSettledProgressionFact(record: StoredDeedRecord): Promise<void> {
    if (!this.bus || !this.flags.has('W20') || !this.flags.has('W12')) return;
    if (!record.playerId) return;
    this.bus.emit('progression.fact', {
      playerId: record.playerId,
      colonyId: record.colonyId,
      planetId: record.planetId,
      atTick: 0,
      eventId: `deed-settled:${record.colonyId}`,
      family: 'settler',
      metric: 'counter',
      value: 1,
    });
  }

  private async resolveDeed(
    colonyId?: string,
    planetId?: string,
  ): Promise<StoredDeedRecord | null> {
    if (colonyId && colonyId !== '0' && colonyId !== 'col_0') {
      const direct = await this.deeds.findByColonyId(colonyId);
      if (direct) return direct;
      const byToken = await this.deeds.findByTokenId(colonyId);
      if (byToken) return byToken;
    }
    if (colonyId) {
      const direct = await this.deeds.findByColonyId(colonyId);
      if (direct) return direct;
    }
    if (planetId) {
      const onPlanet = await this.deeds.listForPlayerOrColony({ planetId });
      if (onPlanet.length > 0) return onPlanet[0] ?? null;
    }
    const all = await this.deeds.listAll();
    return all[0] ?? null;
  }
}
