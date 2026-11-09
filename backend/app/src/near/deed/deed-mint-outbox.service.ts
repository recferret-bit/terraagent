import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  deedMintOpId,
  deedTokenId,
  type DeedHexCoord,
  type DeedPlanetType,
  type DeedUpdatedPayload,
} from '@terra/contracts';
import { withTransaction, type PrismaClient } from '@terra/db';
import type { PlanetEventV1 } from '../../bus/channels.js';
import { EventBus } from '../../bus/event-bus.js';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { ChainOutboxRepository, type ClaimedRow } from '../application/outbox/chain-outbox.repository.js';
import { OutboxListeners } from '../application/outbox/outbox-listeners.js';
import { resolveColonyAccountId } from '../cargo/cargo-export-outbox.js';
import { DeedRepository, type StoredDeedRecord } from './deed.repository.js';
import {
  buildInitialDeedMetadata,
  enqueueDeedMintIfPending,
  extractMintRowColonyId,
} from './parts/deed-mint-helpers.js';

export interface NearDeedUpdatedBusEvent {
  readonly planetId: string;
  readonly playerId?: string;
  readonly colonyId: string;
  readonly payload: DeedUpdatedPayload;
}

declare module '../../bus/channels.js' {
  interface BusChannels {
    'near.deed.updated': NearDeedUpdatedBusEvent;
  }
}

export interface MintDeedForColonyInput {
  readonly colonyId: string;
  readonly planetId: string;
  readonly playerId?: string | null;
  readonly colonyIndex?: number;
  readonly colonyName?: string;
  readonly planetType?: DeedPlanetType;
  readonly stage?: number;
  readonly terraformBp?: number;
  readonly territoryHexes?: readonly DeedHexCoord[];
}

export interface DeedMintEnqueued {
  readonly colonyId: string;
  readonly tokenId: string;
  readonly accountId: string;
  readonly opId: string;
  readonly record: StoredDeedRecord;
}

/**
 * Listens for `colonyFounded` on `planet.event` and atomically writes `chain.deed` (`PENDING`)
 * and enqueues a `DeedNft.mint` row in `chain.chain_outbox` with `opId = deed-mint:{colonyId}` (W20-05, NEAR-90).
 */
@Injectable()
export class DeedMintOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(DeedMintOutboxService.name);
  private readonly stops: Array<() => void> = [];

  constructor(
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(DeedRepository) private readonly deeds: DeedRepository,
    @Optional() @Inject(EventBus) private readonly bus?: EventBus,
    @Optional() @Inject(ChainOutboxRepository) private readonly outbox?: ChainOutboxRepository,
    @Optional() @Inject(OutboxListeners) private readonly listeners?: OutboxListeners,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
  ) {}

  onModuleInit(): void {
    if (this.stops.length > 0) return;
    if (this.bus) {
      this.stops.push(
        this.bus.on('planet.event', (ev) => this.onPlanetEvent(ev), {
          module: 'DeedMintOutboxService',
        }),
      );
    }
    if (this.listeners) {
      this.stops.push(
        this.listeners.onDone((row, res, txHash) => this.onOutboxRowDone(row, res, txHash)),
        this.listeners.onFailed((row, err, dead) => this.onOutboxRowFailed(row, err, dead)),
      );
    }
    if (this.flags.has('W20') && this.env?.NODE_ENV !== 'test') {
      void this.reconcilePendingMints().catch((err: unknown) => {
        this.log.warn(
          `deed mint reconciliation failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
  }

  onModuleDestroy(): void {
    for (const stop of this.stops.splice(0)) stop();
  }

  private onPlanetEvent(event: PlanetEventV1): void {
    if (event.kind !== 'colonyFounded') return;
    if (!this.flags.has('W20')) return;
    const data = (event.data ?? {}) as Record<string, unknown>;
    const colonyId =
      typeof data.colonyId === 'string' && data.colonyId.length > 0
        ? data.colonyId
        : typeof event.colonyIds?.[0] === 'string'
          ? event.colonyIds[0]
          : '';
    if (!colonyId) return;
    const playerId = typeof data.playerId === 'string' ? data.playerId : null;
    const colonyName = typeof data.name === 'string' ? data.name : undefined;
    const rawColonyIndex = data.colonyIndex ?? (event as { colony?: unknown }).colony;
    const colonyIndex =
      typeof rawColonyIndex === 'number' && Number.isFinite(rawColonyIndex) ? rawColonyIndex : 0;

    void this.mintForColony({
      colonyId,
      planetId: event.planetId,
      playerId,
      colonyIndex,
      colonyName,
    }).catch((err: unknown) => {
      this.log.warn(
        `deed mint outbox enqueue failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  async mintForColony(input: MintDeedForColonyInput): Promise<DeedMintEnqueued | null> {
    if (!this.flags.has('W20')) return null;
    const colonyId = input.colonyId.trim();
    if (!colonyId) return null;

    const tokenId = deedTokenId(colonyId);
    const opId = deedMintOpId(colonyId);
    const metadata = buildInitialDeedMetadata(this.flags, input, tokenId);

    const db = this.database();
    if (db) {
      return withTransaction(db, async (tx) => {
        const rawAccountId = await resolveColonyAccountId(
          tx,
          colonyId,
          input.playerId ?? null,
          input.planetId,
          input.colonyIndex ?? 0,
        );
        const accountId = rawAccountId.replace(/[-_]{2,}/g, '-');
        if (accountId !== rawAccountId) {
          await tx.mockChainAccount.upsert({
            where: { accountId },
            create: { accountId, kind: 'colony' },
            update: {},
          });
        }
        const { record } = await this.deeds.upsertInitialMint(
          {
            colonyId,
            planetId: input.planetId,
            playerId: input.playerId ?? null,
            accountId,
            tokenId,
            metadata,
            opId,
          },
          tx,
        );
        await enqueueDeedMintIfPending(
          this.outbox,
          opId,
          tokenId,
          record,
          colonyId,
          input.planetId,
          tx,
        );
        return { colonyId, tokenId, accountId: record.accountId, opId, record };
      });
    }

    const fallbackAccountId = `${colonyId.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}.terraagent.mock`;
    const { record } = await this.deeds.upsertInitialMint({
      colonyId,
      planetId: input.planetId,
      playerId: input.playerId ?? null,
      accountId: fallbackAccountId,
      tokenId,
      metadata,
      opId,
    });
    await enqueueDeedMintIfPending(this.outbox, opId, tokenId, record, colonyId, input.planetId);
    return { colonyId, tokenId, accountId: record.accountId, opId, record };
  }

  async onOutboxRowDone(row: ClaimedRow, _result: object, txHash: string | null): Promise<void> {
    if (row.port !== 'DeedNft' || row.method !== 'mint') return;
    const colonyId = extractMintRowColonyId(row);
    if (!colonyId) return;

    const updated = await this.deeds.markOutboxDone(colonyId, row.opId, txHash, 1);
    if (!updated) return;

    await this.emitDeedMintedAndPush(updated, 'Colony founded — Deed minted', txHash);
  }

  async onOutboxRowFailed(row: ClaimedRow, error: string, dead: boolean): Promise<void> {
    if (row.port !== 'DeedNft' || row.method !== 'mint') return;
    const colonyId = extractMintRowColonyId(row);
    if (!colonyId) return;

    const updated = await this.deeds.markOutboxFailed(colonyId, row.opId, error, dead);
    if (!updated) return;
    await this.pushDeedUpdated(updated, 'Deed mint pending retry');
  }

  /**
   * Crash-safety reconciler: if the process crashed after `DeedNft.mint` succeeded in `chain_outbox`
   * or before `chain_outbox` was enqueued, finishes or re-enqueues without creating a second deed.
   */
  async reconcilePendingMints(): Promise<number> {
    if (!this.flags.has('W20')) return 0;
    const db = this.database();
    if (!db || !this.outbox) return 0;

    const pendingDeeds = await db.deed.findMany({
      where: {
        chainState: 'PENDING',
        metadataVersion: 1,
      },
      include: { history: { orderBy: { version: 'asc' } } },
    });

    let reconciled = 0;
    for (const row of pendingDeeds) {
      const opId = row.pendingOpId ?? deedMintOpId(row.colonyId);
      const outboxRow = await this.outbox.find(opId);
      if (outboxRow?.status === 'DONE') {
        await this.deeds.markOutboxDone(row.colonyId, opId, outboxRow.txHash, 1);
        reconciled += 1;
      } else if (!outboxRow) {
        await this.outbox.enqueue({
          opId,
          port: 'DeedNft',
          method: 'mint',
          payload: {
            collection: 'deed',
            tokenId: row.tokenId,
            ownerAccountId: row.accountId,
            owner: row.accountId,
            metadata: row.metadata as Record<string, unknown>,
            metadataJson: JSON.stringify(row.metadata),
            colonyId: row.colonyId,
            planetId: row.planetId,
          },
        });
        reconciled += 1;
      }
    }
    return reconciled;
  }

  async pushDeedUpdated(
    record: StoredDeedRecord,
    change: string,
    txHash?: string | null,
  ): Promise<void> {
    if (!this.bus || !this.flags.has('W20')) return;
    const view = await this.deeds.toDeedView(record);
    const payload: DeedUpdatedPayload = {
      colonyId: record.colonyId,
      planetId: record.planetId,
      tokenId: record.tokenId,
      version: record.metadataVersion,
      change,
      status: record.status,
      settled: record.settled,
      metadata: record.metadata,
      pendingState: view.pendingState,
      ...(txHash || record.lastUpdateTx ? { txHash: (txHash ?? record.lastUpdateTx)! } : {}),
      deed: view,
    };
    this.bus.emit('near.deed.updated', {
      planetId: record.planetId,
      ...(record.playerId ? { playerId: record.playerId } : {}),
      colonyId: record.colonyId,
      payload,
    });
  }

  private async emitDeedMintedAndPush(
    record: StoredDeedRecord,
    change: string,
    txHash: string | null,
  ): Promise<void> {
    if (this.bus && this.flags.has('W20')) {
      this.bus.emit('planet.event', {
        planetId: record.planetId,
        tick: 0,
        kind: 'deedMinted',
        severity: 'info',
        colonyIds: [record.colonyId],
        data: {
          colonyId: record.colonyId,
          planetId: record.planetId,
          tokenId: record.tokenId,
          ownerAccountId: record.accountId,
          txHash: txHash ?? record.lastUpdateTx ?? 'mock:deed',
          version: record.metadataVersion,
        },
      });
    }
    await this.pushDeedUpdated(record, change, txHash);
  }

  private database(): PrismaClient | null {
    return this.env && databaseEnabled(this.env) && this.prisma ? this.prisma : null;
  }
}
