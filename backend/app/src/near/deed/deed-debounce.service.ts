import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  DeedMetadataV1,
  deedFinalOpId,
  deedMetaOpId,
  deedSettleOpId,
} from '@terra/contracts';
import { withTransaction, type DbClient, type PrismaClient } from '@terra/db';
import { EventBus } from '../../bus/event-bus.js';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { GamePlanets } from '../../game/game-planets.service.js';
import { ChainOutboxRepository, type ClaimedRow } from '../application/outbox/chain-outbox.repository.js';
import { OutboxListeners } from '../application/outbox/outbox-listeners.js';
import { DeedMintOutboxService } from './deed-mint-outbox.service.js';
import { DeedProjectorService, type DeedMilestonePatch } from './deed-projector.service.js';
import { DeedRepository, type StoredDeedRecord } from './deed.repository.js';

export const DEED_DEBOUNCE_WINDOW_MS = 10 * 60 * 1000;

interface PendingDebounceEntry {
  colonyId: string;
  dueAtMs: number;
}

export interface FlushedDeedUpdate {
  readonly colonyId: string;
  readonly tokenId: string;
  readonly version: number;
  readonly opId: string;
  readonly metadata: DeedMetadataV1;
  readonly change: string;
}

/**
 * Debounces dynamic `DeedMetadataV1` updates so at most one `DeedNft.updateMetadata`
 * is enqueued per colony per 10 minutes (`opId = deed-meta:{colonyId}:{version}`),
 * coalescing rapid milestones into the latest state (W20-07, NEAR-91).
 */
@Injectable()
export class DeedDebounceService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(DeedDebounceService.name);
  private readonly stops: Array<() => void> = [];
  private readonly pendingByColony = new Map<string, PendingDebounceEntry>();
  private readonly lastDispatchedAtByColony = new Map<string, number>();
  private clockOffsetMs = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(DeedRepository) private readonly deeds: DeedRepository,
    @Inject(DeedProjectorService) private readonly projector: DeedProjectorService,
    @Inject(DeedMintOutboxService) private readonly mintService: DeedMintOutboxService,
    @Optional() @Inject(EventBus) private readonly bus?: EventBus,
    @Optional() @Inject(ChainOutboxRepository) private readonly outbox?: ChainOutboxRepository,
    @Optional() @Inject(OutboxListeners) private readonly listeners?: OutboxListeners,
    @Optional() @Inject(GamePlanets) private readonly planets?: GamePlanets,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
  ) {}

  onModuleInit(): void {
    if (this.stops.length > 0) return;
    this.stops.push(
      this.projector.onMilestoneQueued((colonyId, patch) =>
        this.onMilestoneQueued(colonyId, patch),
      ),
    );
    if (this.listeners) {
      this.stops.push(
        this.listeners.onDone((row, res, txHash) => this.onOutboxRowDone(row, res, txHash)),
        this.listeners.onFailed((row, err, dead) => this.onOutboxRowFailed(row, err, dead)),
      );
    }
    if (this.planets) {
      this.stops.push(
        this.planets.onWarp((_planetId, k) => {
          if (k > 1) {
            void this.advanceClockMs(k * 60_000).catch((err: unknown) => {
              this.log.warn(
                `deed debounce warp flush failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            });
          }
        }),
      );
    }
    if (this.flags.has('W20') && this.env?.NODE_ENV !== 'test') {
      this.timer = setInterval(() => {
        void this.flushReady().catch((err: unknown) => {
          this.log.warn(
            `deed debounce periodic flush failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }, 1000);
      this.timer.unref();
    }
  }

  onModuleDestroy(): void {
    for (const stop of this.stops.splice(0)) stop();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  nowMs(): number {
    return Date.now() + this.clockOffsetMs;
  }

  pendingCount(): number {
    return this.pendingByColony.size;
  }

  async advanceClockMs(deltaMs: number): Promise<FlushedDeedUpdate[]> {
    if (Number.isFinite(deltaMs) && deltaMs > 0) {
      this.clockOffsetMs += Math.floor(deltaMs);
    }
    return this.flushReady();
  }

  private async onMilestoneQueued(colonyId: string, patch: DeedMilestonePatch): Promise<void> {
    if (!this.flags.has('W20')) return;
    if (patch.forceImmediate) {
      await this.flushColony(colonyId, { forceImmediate: true });
      return;
    }
    if (!this.pendingByColony.has(colonyId)) {
      const now = this.nowMs();
      const lastDispatched = this.lastDispatchedAtByColony.get(colonyId) ?? now;
      const dueAtMs = Math.max(now + DEED_DEBOUNCE_WINDOW_MS, lastDispatched + DEED_DEBOUNCE_WINDOW_MS);
      this.pendingByColony.set(colonyId, { colonyId, dueAtMs });
    }
  }

  async flushReady(atMs = this.nowMs()): Promise<FlushedDeedUpdate[]> {
    if (!this.flags.has('W20')) return [];
    const flushed: FlushedDeedUpdate[] = [];
    for (const [colonyId, entry] of [...this.pendingByColony.entries()]) {
      if (atMs >= entry.dueAtMs) {
        const res = await this.flushColony(colonyId);
        if (res) flushed.push(res);
      }
    }
    return flushed;
  }

  async flushColony(
    colonyId: string,
    opts?: { forceImmediate?: boolean; opIdOverride?: string },
  ): Promise<FlushedDeedUpdate | null> {
    if (!this.flags.has('W20')) return null;
    const patch = this.projector.getQueuedMilestone(colonyId);
    if (!patch) {
      this.pendingByColony.delete(colonyId);
      return null;
    }
    const record = await this.deeds.findByColonyId(colonyId);
    if (!record) {
      this.pendingByColony.delete(colonyId);
      this.projector.clearQueuedMilestone(colonyId);
      return null;
    }

    const nextVersion = record.metadataVersion + 1;
    const opId =
      opts?.opIdOverride ??
      (patch.settled
        ? deedSettleOpId(colonyId)
        : opts?.forceImmediate || patch.forceImmediate
          ? deedFinalOpId(colonyId, nextVersion)
          : deedMetaOpId(colonyId, nextVersion));

    const nextMetadata = this.projector.sanitizeMetadataForActiveWaves({
      ...record.metadata,
      ...(patch.colonyName !== undefined ? { colonyName: patch.colonyName } : {}),
      ...(patch.planetType !== undefined ? { planetType: patch.planetType } : {}),
      ...(patch.stage !== undefined ? { stage: patch.stage } : {}),
      ...(patch.terraformBp !== undefined ? { terraformBp: patch.terraformBp } : {}),
      ...(patch.walls !== undefined ? { walls: patch.walls } : {}),
      ...(patch.tradeVolume !== undefined ? { tradeVolume: patch.tradeVolume } : {}),
      ...(patch.truces !== undefined ? { truces: patch.truces } : {}),
      ...(patch.rank !== undefined ? { rank: patch.rank } : {}),
      ...(patch.territoryHexes !== undefined
        ? { territoryHexes: [...patch.territoryHexes] }
        : {}),
      status: patch.status ?? record.metadata.status,
      settled: patch.settled ?? record.metadata.settled,
      version: nextVersion,
      imageUrl: `/v1/near/deed/${encodeURIComponent(record.tokenId)}/image.png?v=${nextVersion}`,
    });

    this.pendingByColony.delete(colonyId);
    this.projector.clearQueuedMilestone(colonyId);
    const now = this.nowMs();
    this.lastDispatchedAtByColony.set(colonyId, now);

    await this.persistAndEnqueueUpdate(record, nextMetadata, nextVersion, opId, patch.change, now);
    return {
      colonyId,
      tokenId: record.tokenId,
      version: nextVersion,
      opId,
      metadata: nextMetadata,
      change: patch.change,
    };
  }

  private buildUpdateOutboxRow(
    record: StoredDeedRecord,
    nextMetadata: DeedMetadataV1,
    nextVersion: number,
    opId: string,
    change: string,
  ) {
    return {
      opId,
      port: 'DeedNft',
      method: 'updateMetadata',
      payload: {
        collection: 'deed',
        tokenId: record.tokenId,
        metadata: nextMetadata,
        metadataJson: JSON.stringify(nextMetadata),
        colonyId: record.colonyId,
        planetId: record.planetId,
        version: nextVersion,
        change,
      },
    };
  }

  private async persistAndEnqueueUpdate(
    record: StoredDeedRecord,
    nextMetadata: DeedMetadataV1,
    nextVersion: number,
    opId: string,
    change: string,
    nowMs: number,
  ): Promise<void> {
    const dispatchedDate = new Date(nowMs);
    const outboxRow = this.buildUpdateOutboxRow(record, nextMetadata, nextVersion, opId, change);
    const db = this.database();
    if (db) {
      await withTransaction(db, async (tx: DbClient) => {
        await tx.deed.update({
          where: { colonyId: record.colonyId },
          data: {
            metadata: nextMetadata as object,
            metadataVersion: nextVersion,
            status: nextMetadata.status,
            settled: nextMetadata.settled,
            chainState: 'PENDING',
            pendingOpId: opId,
            pendingMilestone: null as never,
            lastDispatchedAt: dispatchedDate,
          },
        });
        await tx.deedHistory.upsert({
          where: { colonyId_version: { colonyId: record.colonyId, version: nextVersion } },
          create: {
            colonyId: record.colonyId,
            tokenId: record.tokenId,
            version: nextVersion,
            change,
            metadata: nextMetadata as object,
            opId,
          },
          update: { change, metadata: nextMetadata as object, opId },
        });
        if (this.outbox) await this.outbox.enqueue(outboxRow, tx);
      });
      return;
    }

    record.metadata = nextMetadata;
    record.metadataVersion = nextVersion;
    record.status = nextMetadata.status;
    record.settled = nextMetadata.settled;
    record.chainState = 'PENDING';
    record.pendingOpId = opId;
    record.pendingMilestone = null;
    record.lastDispatchedAt = dispatchedDate;
    record.updatedAt = dispatchedDate;
    record.history.push({
      colonyId: record.colonyId,
      tokenId: record.tokenId,
      version: nextVersion,
      change,
      metadata: nextMetadata,
      opId,
      txHash: null,
      createdAt: dispatchedDate,
    });
    if (this.outbox) await this.outbox.enqueue(outboxRow);
  }

  async onOutboxRowDone(row: ClaimedRow, _result: object, txHash: string | null): Promise<void> {
    if (row.port !== 'DeedNft' || row.method !== 'updateMetadata') return;
    const colonyId =
      typeof row.payload.colonyId === 'string' && row.payload.colonyId.length > 0
        ? row.payload.colonyId
        : null;
    if (!colonyId) return;
    const version =
      typeof row.payload.version === 'number' && Number.isFinite(row.payload.version)
        ? row.payload.version
        : 2;
    const change =
      typeof row.payload.change === 'string' && row.payload.change.length > 0
        ? row.payload.change
        : 'Deed metadata updated';

    const updated = await this.deeds.markOutboxDone(colonyId, row.opId, txHash, version);
    if (!updated) return;

    if (this.bus && this.flags.has('W20')) {
      this.bus.emit('planet.event', {
        planetId: updated.planetId,
        tick: 0,
        kind: 'deedUpdated',
        severity: 'info',
        colonyIds: [updated.colonyId],
        data: {
          colonyId: updated.colonyId,
          planetId: updated.planetId,
          tokenId: updated.tokenId,
          version: updated.metadataVersion,
          change,
          ...(updated.metadata.terraformBp !== undefined
            ? { terraformBp: updated.metadata.terraformBp }
            : {}),
          ...(updated.metadata.stage !== undefined ? { stage: updated.metadata.stage } : {}),
          status: updated.status,
          settled: updated.settled,
          ...(txHash || updated.lastUpdateTx
            ? { txHash: (txHash ?? updated.lastUpdateTx)! }
            : {}),
        },
      });
    }
    await this.mintService.pushDeedUpdated(updated, change, txHash);
  }

  async onOutboxRowFailed(row: ClaimedRow, error: string, dead: boolean): Promise<void> {
    if (row.port !== 'DeedNft' || row.method !== 'updateMetadata') return;
    const colonyId =
      typeof row.payload.colonyId === 'string' && row.payload.colonyId.length > 0
        ? row.payload.colonyId
        : null;
    if (!colonyId) return;

    const updated = await this.deeds.markOutboxFailed(colonyId, row.opId, error, dead);
    if (!updated) return;
    await this.mintService.pushDeedUpdated(updated, 'Deed metadata update pending retry');
  }

  private database(): PrismaClient | null {
    return this.env && databaseEnabled(this.env) && this.prisma ? this.prisma : null;
  }
}
