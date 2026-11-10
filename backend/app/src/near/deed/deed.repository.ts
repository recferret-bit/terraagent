import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DeedMetadataV1,
  deedTokenId,
  DeedView,
  MOCK_DEED_CONTRACT,
  PublicDeedResponse,
  type DeedHistoryEntry,
  type DeedStatus,
} from '@terra/contracts';
import type { DbClient, PrismaClient } from '@terra/db';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import {
  buildPlayerOrColonyWhere,
  createInMemoryDeedRecord,
  filterInMemoryDeeds,
  fromDeedDbRow,
  lookupDeedClaimAndRetries,
  resolveDeedPendingState,
  upsertInitialMintInDb,
  type UpsertInitialMintInput,
} from './parts/deed-repo-helpers.js';

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
      return row ? fromDeedDbRow(row) : null;
    }
    return this.mem.get(colonyId) ?? null;
  }

  async findByTokenId(tokenId: string, tx?: DbClient): Promise<StoredDeedRecord | null> {
    const raw = tokenId.trim();
    const bare = raw.replace(/^deed[:-]/, '');
    const candidates = Array.from(new Set([deedTokenId(raw), deedTokenId(bare), raw]));
    const client = tx ?? this.db;
    if (client && 'deed' in client && client.deed) {
      for (const candidate of candidates) {
        const row = await client.deed.findUnique({
          where: { tokenId: candidate },
          include: { history: { orderBy: { version: 'asc' } } },
        });
        if (row) return fromDeedDbRow(row);
      }
      return bare ? this.findByColonyId(bare, tx) : null;
    }
    for (const r of this.mem.values()) {
      if (candidates.includes(r.tokenId) || r.colonyId === raw || r.colonyId === bare) return r;
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
      const where = buildPlayerOrColonyWhere(opts);
      const rows = await client.deed.findMany({
        where,
        include: { history: { orderBy: { version: 'asc' } } },
        orderBy: { createdAt: 'desc' },
      });
      if (rows.length > 0 || opts.colonyId) {
        return rows.map((r) => fromDeedDbRow(r));
      }
      const fallbackRows = await client.deed.findMany({
        include: { history: { orderBy: { version: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      return fallbackRows.map((r) => fromDeedDbRow(r));
    }
    return filterInMemoryDeeds([...this.mem.values()], opts);
  }

  async listAll(): Promise<StoredDeedRecord[]> {
    const client = this.db;
    if (client && 'deed' in client && client.deed) {
      const rows = await client.deed.findMany({
        include: { history: { orderBy: { version: 'asc' } } },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((r) => fromDeedDbRow(r));
    }
    return [...this.mem.values()];
  }

  async upsertInitialMint(
    input: UpsertInitialMintInput,
    tx?: DbClient,
  ): Promise<{ record: StoredDeedRecord; created: boolean }> {
    const change = input.change ?? 'Colony founded — Deed minted';
    const client = tx ?? this.db;
    if (client && 'deed' in client && client.deed) {
      return upsertInitialMintInDb(client, input, change);
    }

    const existing = this.mem.get(input.colonyId);
    if (existing) return { record: existing, created: false };
    const record = createInMemoryDeedRecord(input, change);
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
      return updated ? fromDeedDbRow(updated) : null;
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
      return updated ? fromDeedDbRow(updated) : null;
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
    const { claimed, claimedBy, retries } = await lookupDeedClaimAndRetries(this.db, record);
    const pendingState = resolveDeedPendingState(record, retries);
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
}
