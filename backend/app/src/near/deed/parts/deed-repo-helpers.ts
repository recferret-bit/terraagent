import {
  DeedMetadataV1,
  MOCK_DEED_CONTRACT,
  type DeedPendingState,
  type DeedStatus,
} from '@terra/contracts';
import type { DbClient, PrismaClient } from '@terra/db';
import type { StoredDeedRecord } from '../deed.repository.js';

export interface DeedDbRow {
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
}

export function fromDeedDbRow(row: DeedDbRow): StoredDeedRecord {
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

export function buildPlayerOrColonyWhere(opts: {
  playerId?: string;
  colonyId?: string;
  planetId?: string;
}): Record<string, unknown> {
  if (opts.colonyId) return { colonyId: opts.colonyId };
  if (opts.playerId && opts.planetId) {
    return { OR: [{ playerId: opts.playerId }, { planetId: opts.planetId }] };
  }
  if (opts.playerId) return { playerId: opts.playerId };
  if (opts.planetId) return { planetId: opts.planetId };
  return {};
}

export function filterInMemoryDeeds(
  all: StoredDeedRecord[],
  opts: { playerId?: string; colonyId?: string; planetId?: string },
): StoredDeedRecord[] {
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

export interface UpsertInitialMintInput {
  colonyId: string;
  planetId: string;
  playerId: string | null;
  accountId: string;
  tokenId: string;
  metadata: DeedMetadataV1;
  opId: string;
  change?: string;
}

function defaultDeedContract(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const mode = env.NEAR_ADAPTER_DEED ?? env.NEAR_ADAPTER_DEED_NFT ?? env.NEAR_MODE;
  if (mode === 'testnet' || mode === 'devnet') {
    return env.NEAR_CONTRACT_DEED?.trim() || `deed.${env.NEAR_ROOT_ACCOUNT?.trim() || 'terraagent.testnet'}`;
  }
  if (mode === 'mainnet') {
    return env.NEAR_CONTRACT_DEED?.trim() || `deed.${env.NEAR_ROOT_ACCOUNT?.trim() || 'terraagent.near'}`;
  }
  return MOCK_DEED_CONTRACT;
}

export async function upsertInitialMintInDb(
  client: DbClient,
  input: UpsertInitialMintInput,
  change: string,
): Promise<{ record: StoredDeedRecord; created: boolean }> {
  const existing = await client.deed.findUnique({
    where: { colonyId: input.colonyId },
    include: { history: { orderBy: { version: 'asc' } } },
  });
  if (existing) {
    return { record: fromDeedDbRow(existing), created: false };
  }
  await client.deed.create({
    data: {
      colonyId: input.colonyId,
      planetId: input.planetId,
      playerId: input.playerId,
      accountId: input.accountId,
      tokenId: input.tokenId,
      contract: defaultDeedContract(),
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
  return { record: fromDeedDbRow(created), created: true };
}

export function createInMemoryDeedRecord(
  input: UpsertInitialMintInput,
  change: string,
): StoredDeedRecord {
  const now = new Date();
  return {
    colonyId: input.colonyId,
    planetId: input.planetId,
    playerId: input.playerId,
    accountId: input.accountId,
    tokenId: input.tokenId,
    contract: defaultDeedContract(),
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
}

export function resolveDeedPendingState(
  record: StoredDeedRecord,
  retries: number,
): DeedPendingState {
  if (record.chainState === 'FAILED') return 'FAILED';
  if (record.chainState === 'PENDING' || record.pendingOpId !== null || retries > 0) {
    return 'PENDING';
  }
  if (record.settled || record.status === 'eliminated' || record.status === 'abandoned') {
    return 'FINAL';
  }
  return 'NONE';
}

export async function lookupDeedClaimAndRetries(
  client: PrismaClient | null,
  record: StoredDeedRecord,
): Promise<{ claimed: boolean; claimedBy: string | null; retries: number }> {
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
