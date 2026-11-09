import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DeedMetadataV1,
  deedTokenId,
  DeedView,
  MOCK_DEED_CONTRACT,
  PublicDeedResponse,
  type DeedHistoryEntry,
  type DeedPendingState,
  type DeedStatus,
} from '@terra/contracts';
import type { DbClient, PrismaClient } from '@terra/db';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';

export interface StoredDeedRecord {
  colonyId: string;
  planetId: string;
  playerId: string | null;
  accountId: string;
  tokenId: string;
  contract: string;
  metadata: DeedMetadataV1;
  metadataVersion: number;
  status: DeedStatus;
  settled: boolean;
  chainState: 'PENDING' | 'ACTIVE' | 'FAILED';
  pendingOpId: string | null;
  lastUpdateTx: string | null;
  lastError: string | null;
  lastDispatchedAt: Date | null;
  lastDispatchedSimMs: bigint;
  pendingMilestone: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  history: StoredDeedHistoryRecord[];
}

export interface StoredDeedHistoryRecord {
  colonyId: string;
  tokenId: string;
  version: number;
  change: string;
  metadata: DeedMetadataV1;
  opId: string;
  txHash: string | null;
  createdAt: Date;
}

@Injectable()
export class DeedRepository {
  private readonly mem = new Map<string, StoredDeedRecord>();

  constructor(
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
  ) {}

  get db(): PrismaClient | null {
    return this.env && databaseEnabled(this.env) && this.prisma && 'deed' in this.prisma
      ? this.prisma
      : null;
  }

  async findByColonyId(colonyId: string, tx?: DbClient): Promise<StoredDeedRecord | null> {
    const client = tx ?? this.db;
    if (client && 'deed' in client && client.deed) {
      const row = await client.deed.findUnique({
        where: { colonyId },
        include: { history: { orderBy: { version: 'asc' } } },
      });
      return row ? this.fromDbRow(row) : null;
    }
    return this.mem.get(colonyId) ?? null;
  }

  async findByTokenId(tokenId: string, tx?: DbClient): Promise<StoredDeedRecord | null> {
    const normalized = deedTokenId(tokenId);
    const client = tx ?? this.db;
    if (client && 'deed' in client && client.deed) {
      const row = await client.deed.findUnique({
        where: { tokenId: normalized },
        include: { history: { orderBy: { version: 'asc' } } },
      });
      return row ? this.fromDbRow(row) : null;
    }
    for (const r of this.mem.values()) {
      if (r.tokenId === normalized || r.colonyId === tokenId) return r;
    }
    return null;
  }

  async listForPlayerOrColony(opts: {
    playerId?: string;
    colonyId?: string;
    planetId?: string;
  }): Promise<StoredDeedRecord[]> {
    const client = this.db;
    if (client && 'deed' in client && client.deed) {
      const where: Record<string, unknown> = {};
      if (opts.colonyId) {
        where.colonyId = opts.colonyId;
      } else if (opts.playerId && opts.planetId) {
        where.OR = [{ playerId: opts.playerId }, { planetId: opts.planetId }];
      } else if (opts.playerId) {
        where.playerId = opts.playerId;
      } else if (opts.planetId) {
        where.planetId = opts.planetId;
      }
      let rows = await client.deed.findMany({
        where,
        include: { history: { orderBy: { version: 'asc' } } },
        orderBy: { createdAt: 'desc' },
      });
      if (rows.length === 0 && !opts.colonyId) {
        rows = await client.deed.findMany({
          include: { history: { orderBy: { version: 'asc' } } },
          orderBy: { createdAt: 'desc' },
          take: 10,
        });
      }
      return rows.map((r) => this.fromDbRow(r));
    }
    const all = [...this.mem.values()];
    if (opts.colonyId) return all.filter((r) => r.colonyId === opts.colonyId);
    if (opts.playerId) {
      const byPlayer = all.filter((r) => r.playerId === opts.playerId);
      if (byPlayer.length > 0) return byPlayer;
    }
    if (opts.planetId) {
      const byPlanet = all.filter((r) => r.planetId === opts.planetId);
      if (byPlanet.length > 0) return byPlanet;
    }
    return all;
  }

  async listAll(): Promise<StoredDeedRecord[]> {
    const client = this.db;
    if (client && 'deed' in client && client.deed) {
      const rows = await client.deed.findMany({
        include: { history: { orderBy: { version: 'asc' } } },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((r) => this.fromDbRow(r));
    }
    return [...this.mem.values()];
  }

  async upsertInitialMint(
    input: {
      colonyId: string;
      planetId: string;
      playerId: string | null;
      accountId: string;
      tokenId: string;
      metadata: DeedMetadataV1;
      opId: string;
      change?: string;
    },
    tx?: DbClient,
  ): Promise<{ record: StoredDeedRecord; created: boolean }> {
    const change = input.change ?? 'Colony founded — Deed minted';
    const client = tx ?? this.db;
    if (client && 'deed' in client && client.deed) {
      const existing = await client.deed.findUnique({
        where: { colonyId: input.colonyId },
        include: { history: { orderBy: { version: 'asc' } } },
      });
      if (existing) {
        return { record: this.fromDbRow(existing), created: false };
      }
      await client.deed.create({
        data: {
          colonyId: input.colonyId,
          planetId: input.planetId,
          playerId: input.playerId,
          accountId: input.accountId,
          tokenId: input.tokenId,
          contract: MOCK_DEED_CONTRACT,
          metadata: input.metadata as object,
          metadataVersion: 1,
          status: input.metadata.status,
          settled: input.metadata.settled,
          chainState: 'PENDING',
          pendingOpId: input.opId,
          lastDispatchedAt: new Date(),
        },
      });
      await client.deedHistory.upsert({
        where: { colonyId_version: { colonyId: input.colonyId, version: 1 } },
        create: {
          colonyId: input.colonyId,
          tokenId: input.tokenId,
          version: 1,
          change,
          metadata: input.metadata as object,
          opId: input.opId,
        },
        update: {},
      });
      const created = await client.deed.findUniqueOrThrow({
        where: { colonyId: input.colonyId },
        include: { history: { orderBy: { version: 'asc' } } },
      });
      return { record: this.fromDbRow(created), created: true };
    }

    const existing = this.mem.get(input.colonyId);
    if (existing) return { record: existing, created: false };
    const now = new Date();
    const record: StoredDeedRecord = {
      colonyId: input.colonyId,
      planetId: input.planetId,
      playerId: input.playerId,
      accountId: input.accountId,
      tokenId: input.tokenId,
      contract: MOCK_DEED_CONTRACT,
      metadata: input.metadata,
      metadataVersion: 1,
      status: input.metadata.status,
      settled: input.metadata.settled,
      chainState: 'PENDING',
      pendingOpId: input.opId,
      lastUpdateTx: null,
      lastError: null,
      lastDispatchedAt: now,
      lastDispatchedSimMs: 0n,
      pendingMilestone: null,
      createdAt: now,
      updatedAt: now,
      history: [
        {
          colonyId: input.colonyId,
          tokenId: input.tokenId,
          version: 1,
          change,
          metadata: input.metadata,
          opId: input.opId,
          txHash: null,
          createdAt: now,
        },
      ],
    };
    this.mem.set(input.colonyId, record);
    return { record, created: true };
  }

  async markOutboxDone(
    colonyId: string,
    opId: string,
    txHash: string | null,
    version = 1,
  ): Promise<StoredDeedRecord | null> {
    const client = this.db;
    if (client && 'deed' in client && client.deed) {
      const existing = await client.deed.findUnique({ where: { colonyId } });
      if (!existing) return null;
      await client.deed.update({
        where: { colonyId },
        data: {
          chainState: 'ACTIVE',
          lastUpdateTx: txHash ?? existing.lastUpdateTx,
          lastError: null,
          ...(existing.pendingOpId === opId ? { pendingOpId: null } : {}),
        },
      });
      await client.deedHistory.updateMany({
        where: { colonyId, OR: [{ opId }, { version }] },
        data: { txHash: txHash ?? undefined },
      });
      const updated = await client.deed.findUnique({
        where: { colonyId },
        include: { history: { orderBy: { version: 'asc' } } },
      });
      return updated ? this.fromDbRow(updated) : null;
    }

    const rec = this.mem.get(colonyId);
    if (!rec) return null;
    rec.chainState = 'ACTIVE';
    if (txHash) rec.lastUpdateTx = txHash;
    rec.lastError = null;
    if (rec.pendingOpId === opId) rec.pendingOpId = null;
    rec.updatedAt = new Date();
    for (const h of rec.history) {
      if (h.opId === opId || h.version === version) h.txHash = txHash;
    }
    return rec;
  }

  async markOutboxFailed(
    colonyId: string,
    opId: string,
    error: string,
    dead: boolean,
  ): Promise<StoredDeedRecord | null> {
    const state = dead ? 'FAILED' : 'PENDING';
    const client = this.db;
    if (client && 'deed' in client && client.deed) {
      const existing = await client.deed.findUnique({ where: { colonyId } });
      if (!existing) return null;
      await client.deed.update({
        where: { colonyId },
        data: {
          chainState: state,
          pendingOpId: opId,
          lastError: error,
        },
      });
      const updated = await client.deed.findUnique({
        where: { colonyId },
        include: { history: { orderBy: { version: 'asc' } } },
      });
      return updated ? this.fromDbRow(updated) : null;
    }

    const rec = this.mem.get(colonyId);
    if (!rec) return null;
    rec.chainState = state;
    rec.pendingOpId = opId;
    rec.lastError = error;
    rec.updatedAt = new Date();
    return rec;
  }

  async toDeedView(record: StoredDeedRecord): Promise<DeedView> {
    const { claimed, claimedBy, retries } = await this.lookupClaimAndRetries(record);
    const pendingState = this.resolvePendingState(record, retries);
    const history: DeedHistoryEntry[] = record.history.map((h) => ({
      version: h.version,
      at: h.createdAt.getTime(),
      change: h.change,
      ...(h.txHash ? { txHash: h.txHash } : {}),
      metadata: h.metadata,
    }));
    const canSettle =
      !record.settled &&
      record.status === 'active' &&
      ((record.metadata.stage ?? 0) >= 4 || (record.metadata.terraformBp ?? 0) >= 10_000);

    return DeedView.parse({
      tokenId: record.tokenId,
      colonyId: record.colonyId,
      planetId: record.planetId,
      ...(record.playerId ? { playerId: record.playerId } : {}),
      ownerAccountId: record.accountId,
      contractId: record.contract || MOCK_DEED_CONTRACT,
      status: record.status,
      settled: record.settled,
      version: record.metadataVersion,
      metadata: record.metadata,
      history,
      pendingState,
      ...(retries > 0 ? { pendingRetries: retries } : {}),
      ...(record.lastError ? { lastError: record.lastError } : {}),
      ...(record.lastUpdateTx ? { txHash: record.lastUpdateTx } : {}),
      mintedAt: record.createdAt.getTime(),
      updatedAt: record.updatedAt.getTime(),
      accountClaimed: claimed,
      claimedByAccountId: claimedBy,
      canSettle,
    });
  }

  toPublicDeedResponse(record: StoredDeedRecord): PublicDeedResponse {
    const history: DeedHistoryEntry[] = record.history.map((h) => ({
      version: h.version,
      at: h.createdAt.getTime(),
      change: h.change,
      ...(h.txHash ? { txHash: h.txHash } : {}),
      metadata: h.metadata,
    }));
    return PublicDeedResponse.parse({
      tokenId: record.tokenId,
      colonyId: record.colonyId,
      planetId: record.planetId,
      ownerAccountId: record.accountId,
      contractId: record.contract || MOCK_DEED_CONTRACT,
      status: record.status,
      settled: record.settled,
      version: record.metadataVersion,
      metadata: record.metadata,
      history,
      ...(record.lastUpdateTx ? { txHash: record.lastUpdateTx } : {}),
      mintedAt: record.createdAt.getTime(),
      updatedAt: record.updatedAt.getTime(),
    });
  }

  private resolvePendingState(record: StoredDeedRecord, retries: number): DeedPendingState {
    if (record.chainState === 'FAILED') return 'FAILED';
    if (record.chainState === 'PENDING' || record.pendingOpId !== null || retries > 0) {
      return 'PENDING';
    }
    if (record.settled || record.status === 'eliminated' || record.status === 'abandoned') {
      return 'FINAL';
    }
    return 'NONE';
  }

  private async lookupClaimAndRetries(
    record: StoredDeedRecord,
  ): Promise<{ claimed: boolean; claimedBy: string | null; retries: number }> {
    const client = this.db;
    if (!client) return { claimed: false, claimedBy: null, retries: 0 };

    let claimed = false;
    let claimedBy: string | null = null;
    if ('nearColonyAccount' in client && client.nearColonyAccount) {
      const acct = await client.nearColonyAccount.findFirst({
        where: { OR: [{ colonyId: record.colonyId }, { accountId: record.accountId }] },
        select: { claimedAt: true, claimedByAccountId: true },
      });
      if (acct?.claimedAt) {
        claimed = true;
        claimedBy = acct.claimedByAccountId ?? null;
      }
    }

    let retries = 0;
    if (record.pendingOpId && 'chainOutbox' in client && client.chainOutbox) {
      const outbox = await client.chainOutbox.findUnique({
        where: { opId: record.pendingOpId },
        select: { attempts: true, status: true },
      });
      if (outbox && outbox.status !== 'DONE') {
        retries = outbox.attempts;
      }
    }
    return { claimed, claimedBy, retries };
  }

  private fromDbRow(row: {
    colonyId: string;
    planetId: string;
    playerId: string | null;
    accountId: string;
    tokenId: string;
    contract: string;
    metadata: unknown;
    metadataVersion: number;
    status: string;
    settled: boolean;
    chainState: string;
    pendingOpId: string | null;
    lastUpdateTx: string | null;
    lastError: string | null;
    lastDispatchedAt: Date | null;
    lastDispatchedSimMs: bigint;
    pendingMilestone: unknown;
    createdAt: Date;
    updatedAt: Date;
    history?: Array<{
      colonyId: string;
      tokenId: string;
      version: number;
      change: string;
      metadata: unknown;
      opId: string;
      txHash: string | null;
      createdAt: Date;
    }>;
  }): StoredDeedRecord {
    return {
      colonyId: row.colonyId,
      planetId: row.planetId,
      playerId: row.playerId,
      accountId: row.accountId,
      tokenId: row.tokenId,
      contract: row.contract,
      metadata: DeedMetadataV1.parse(row.metadata),
      metadataVersion: row.metadataVersion,
      status: row.status as DeedStatus,
      settled: row.settled,
      chainState: (row.chainState as 'PENDING' | 'ACTIVE' | 'FAILED') || 'PENDING',
      pendingOpId: row.pendingOpId,
      lastUpdateTx: row.lastUpdateTx,
      lastError: row.lastError,
      lastDispatchedAt: row.lastDispatchedAt,
      lastDispatchedSimMs: row.lastDispatchedSimMs,
      pendingMilestone: (row.pendingMilestone as Record<string, unknown> | null) ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      history: (row.history ?? []).map((h) => ({
        colonyId: h.colonyId,
        tokenId: h.tokenId,
        version: h.version,
        change: h.change,
        metadata: DeedMetadataV1.parse(h.metadata),
        opId: h.opId,
        txHash: h.txHash,
        createdAt: h.createdAt,
      })),
    };
  }
}
