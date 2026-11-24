import type { DbClient } from '@terra/db';

/** The wallet behind a colony or account: every account id and colony it spans, and one stable wallet key. */
export interface WalletRef {
  readonly walletKey: string;
  readonly accountIds: readonly string[];
  readonly colonyIds: readonly string[];
  readonly playerId: string | null;
}

export interface StakeClock {
  /** ACTIVE stake only: unbonding and withdrawable principal never count towards a tier. */
  readonly activeStakedYocto: bigint;
  readonly unbondingYocto: bigint;
  /** Earliest continuous-stake start over the wallet's positions that still hold stake (24h fee warmup). */
  readonly stakedSinceMs: number | null;
  /** Latest deposit over the wallet's positions (7-day early-exit fee clock). */
  readonly lastStakedAtMs: number | null;
}

export const EMPTY_STAKE_CLOCK: StakeClock = Object.freeze({
  activeStakedYocto: 0n,
  unbondingYocto: 0n,
  stakedSinceMs: null,
  lastStakedAtMs: null,
});

interface LinkRow {
  readonly colonyId?: string | null;
  readonly accountId: string;
  readonly ownerAccountId?: string | null;
  readonly claimedByAccountId?: string | null;
  readonly playerId?: string | null;
}

const LINK_SELECT = { colonyId: true, accountId: true, ownerAccountId: true, claimedByAccountId: true, playerId: true } as const;

/** W28 wallet-first: a wallet with no colony row is still a pilot's when a `social_identity` links it (any provider). */
async function linkedPlayerId(db: DbClient, accountIds: readonly string[]): Promise<string | null> {
  if (accountIds.length === 0 || typeof db.socialIdentity?.findFirst !== 'function') return null;
  const row = (await db.socialIdentity.findFirst({
    where: { accountId: { in: [...accountIds] } },
    orderBy: { createdAt: 'asc' },
    select: { playerId: true },
  })) as { playerId: string } | null;
  return row?.playerId ?? null;
}

/**
 * A player's staking wallet from `core.social_identity`: the self-custody NEAR wallet link (`provider: near-wallet`)
 * wins over the custodial named account a Google / X / FastAuth sign-in creates; else the oldest link.
 */
export async function playerLinkedWallet(
  db: DbClient,
  playerId: string,
): Promise<{ accountId: string; playerId: string; isNearWallet: boolean } | null> {
  if (typeof db.socialIdentity?.findFirst !== 'function') return null;
  const pick = async (where: Record<string, unknown>) =>
    ((await db.socialIdentity.findFirst({ where, orderBy: { createdAt: 'asc' }, select: { accountId: true } })) as { accountId: string | null } | null)?.accountId ?? null;
  const nearWallet = await pick({ playerId, provider: NEAR_WALLET_PROVIDER });
  if (nearWallet) return { accountId: nearWallet, playerId, isNearWallet: true };
  const fallback = await pick({ playerId });
  return fallback ? { accountId: fallback, playerId, isNearWallet: false } : null;
}

/** `core.social_identity.provider` of a self-custody NEAR wallet link (`social-auth.service.ts`). */
export const NEAR_WALLET_PROVIDER = 'near-wallet';

async function resolveColonyPlayerId(db: DbClient, colonyIds: readonly string[]): Promise<string | null> {
  if (colonyIds.length === 0) return null;
  if (typeof db.colony?.findFirst === 'function') {
    const row = (await db.colony.findFirst({
      where: { id: { in: [...colonyIds] } },
      select: { playerId: true },
    })) as { playerId: string | null } | null;
    if (row?.playerId) return row.playerId;
  }
  if (colonyIds.length === 1 && typeof db.colony?.findUnique === 'function') {
    const row = (await db.colony.findUnique({
      where: { id: colonyIds[0]! },
      select: { playerId: true },
    })) as { playerId: string | null } | null;
    return row?.playerId ?? null;
  }
  return null;
}

async function expandPlayerLinks(
  db: DbClient,
  playerId: string,
  explicitPlayerQuery: boolean,
  accounts: Set<string>,
  colonies: Set<string>,
  absorb: (rows: readonly LinkRow[]) => void,
): Promise<{ accountId: string; isNearWallet: boolean } | null> {
  const linked = await playerLinkedWallet(db, playerId);
  if (!linked && !explicitPlayerQuery) return null;
  if (linked) accounts.add(linked.accountId);
  if (typeof db.socialIdentity?.findMany === 'function') {
    const socialRows = (await db.socialIdentity.findMany({
      where: { playerId },
      select: { accountId: true },
    })) as Array<{ accountId: string | null }>;
    for (const s of socialRows) if (s.accountId) accounts.add(s.accountId);
  }
  if (typeof db.nearColonyAccount?.findMany === 'function') {
    const playerRows = (await db.nearColonyAccount.findMany({
      where: { playerId },
      select: LINK_SELECT,
    })) as LinkRow[];
    const compatible = linked
      ? playerRows.filter((r) => !r.claimedByAccountId || r.claimedByAccountId === linked.accountId)
      : playerRows;
    absorb(compatible);
  }
  if (typeof db.colony?.findMany === 'function') {
    const cols = (await db.colony.findMany({
      where: { playerId },
      select: { id: true },
    })) as Array<{ id: string }>;
    for (const c of cols) if (c.id) colonies.add(c.id);
  }
  return linked ? { accountId: linked.accountId, isNearWallet: linked.isNearWallet } : null;
}

/**
 * Resolves the unified wallet across `chain.near_colony_account`, `core.colony`, and `core.social_identity` in BOTH
 * directions: querying a custodial colony sub-account (`co_1.pilots.*`) joins the pilot's linked NEAR wallet
 * (`alice.near`), and querying `alice.near` joins all of that pilot's colonies and custodial sub-accounts.
 */
export async function resolveWallet(
  db: DbClient,
  query: { readonly colonyId?: string | null; readonly accountId?: string | null; readonly playerId?: string | null },
): Promise<WalletRef> {
  const colonyId = query.colonyId?.trim() || undefined;
  const given = query.accountId?.trim() || undefined;
  const accounts = new Set<string>(given ? [given] : []);
  const colonies = new Set<string>(colonyId ? [colonyId] : []);
  const owners = new Set<string>();
  const claimants = new Set<string>();
  let firstColonyAcct: string | undefined;
  let playerId: string | null = query.playerId?.trim() || null;

  const absorb = (rows: readonly LinkRow[]): void => {
    for (const r of rows) {
      accounts.add(r.accountId);
      firstColonyAcct ??= r.accountId;
      if (r.colonyId) colonies.add(r.colonyId);
      if (r.ownerAccountId) owners.add(r.ownerAccountId);
      if (r.claimedByAccountId) claimants.add(r.claimedByAccountId);
      playerId ??= r.playerId ?? null;
    }
  };

  if (typeof db.nearColonyAccount?.findMany === 'function' && (colonyId || given || playerId)) {
    const or: Array<Record<string, string>> = colonyId ? [{ colonyId }] : [];
    if (given) or.push({ accountId: given }, { ownerAccountId: given }, { claimedByAccountId: given });
    if (playerId) or.push({ playerId });
    absorb((await db.nearColonyAccount.findMany({ where: { OR: or }, select: LINK_SELECT })) as LinkRow[]);
  }

  playerId ??= await resolveColonyPlayerId(db, [...colonies]);
  playerId ??= await linkedPlayerId(db, [...accounts]);

  const explicitPlayerQuery = Boolean(query.playerId?.trim());
  const socialLink = playerId ? await expandPlayerLinks(db, playerId, explicitPlayerQuery, accounts, colonies, absorb) : null;

  for (const o of [...owners, ...claimants]) accounts.add(o);
  if (typeof db.nearColonyAccount?.findMany === 'function' && owners.size + claimants.size > 0) {
    const second = (await db.nearColonyAccount.findMany({
      where: { OR: [{ ownerAccountId: { in: [...owners] } }, { claimedByAccountId: { in: [...claimants] } }] },
      select: LINK_SELECT,
    })) as LinkRow[];
    absorb(second);
    for (const o of [...owners, ...claimants]) accounts.add(o);
  }

  const primary =
    (claimants.size > 0 ? [...claimants].sort()[0] : undefined) ??
    (socialLink?.isNearWallet ? socialLink.accountId : undefined) ??
    (owners.size > 0 ? [...owners].sort()[0] : undefined) ??
    socialLink?.accountId ??
    given ??
    firstColonyAcct;
  const walletKey = primary ?? (colonyId ? `colony:${colonyId}` : 'anonymous');
  return { walletKey, accountIds: [...accounts], colonyIds: [...colonies], playerId };
}

interface PositionRow {
  readonly colonyId?: string;
  readonly poolId?: string;
  readonly accountId?: string;
  readonly stakedSnapshot?: { toFixed(n: number): string };
  readonly unbondingSnapshot?: { toFixed(n: number): string } | null;
  readonly stakedSinceAt?: Date | null;
  readonly lastStakedAt?: Date | null;
  readonly updatedAt?: Date | null;
}

interface MockRow {
  readonly accountId?: string;
  readonly staked?: { toFixed(n: number): string };
  readonly unbonding?: { toFixed(n: number): string } | null;
  readonly stakedSinceAt?: Date | null;
  readonly lastStakedAt?: Date | null;
  readonly updatedAt?: Date | null;
}

const toYocto = (d: { toFixed(n: number): string } | null | undefined): bigint => (d ? BigInt(d.toFixed(0)) : 0n);

/**
 * Reads the wallet's ACTIVE stake and stake clocks from `chain.staking_position`, falling back per account to
 * `chain.mock_chain_staking` for accounts with no read-model row. Rows without a `stakedSinceAt` (pre-W28) fall back
 * to their `updatedAt`.
 */
export async function readStakeClock(db: DbClient, wallet: WalletRef): Promise<StakeClock> {
  const or: Array<Record<string, unknown>> = [];
  if (wallet.colonyIds.length > 0) or.push({ colonyId: { in: [...wallet.colonyIds] } });
  if (wallet.accountIds.length > 0) or.push({ accountId: { in: [...wallet.accountIds] } });
  if (or.length === 0) return EMPTY_STAKE_CLOCK;

  const rawPositions =
    typeof db.stakingPosition?.findMany === 'function'
      ? ((await db.stakingPosition.findMany({
          where: { OR: or },
          select: { colonyId: true, poolId: true, accountId: true, stakedSnapshot: true, unbondingSnapshot: true, stakedSinceAt: true, lastStakedAt: true, updatedAt: true },
        })) as PositionRow[])
      : [];
  const dedupedPositions = new Map<string, PositionRow>();
  let anonIdx = 0;
  for (const p of rawPositions) {
    const key = p.accountId && p.poolId
      ? `acct:${p.accountId}::pool:${p.poolId}`
      : p.accountId
        ? `acct:${p.accountId}::row:${anonIdx++}`
        : `col:${p.colonyId ?? anonIdx++}::pool:${p.poolId ?? ''}`;
    const prev = dedupedPositions.get(key);
    if (!prev || (p.updatedAt?.getTime() ?? 0) >= (prev.updatedAt?.getTime() ?? 0)) {
      dedupedPositions.set(key, p);
    }
  }
  const positions = [...dedupedPositions.values()];
  const covered = new Set(positions.map((p) => p.accountId).filter((a): a is string => Boolean(a)));
  const wanted = wallet.accountIds.filter((a) => !covered.has(a));
  const mocks =
    wanted.length > 0 && typeof db.mockChainStaking?.findMany === 'function'
      ? ((await db.mockChainStaking.findMany({
          where: { accountId: { in: wanted } },
          select: { accountId: true, staked: true, unbonding: true, stakedSinceAt: true, lastStakedAt: true, updatedAt: true },
        })) as MockRow[])
      : [];

  let active = 0n;
  let unbonding = 0n;
  let since: number | null = null;
  let last: number | null = null;
  const fold = (staked: bigint, unb: bigint, r: PositionRow | MockRow): void => {
    active += staked;
    unbonding += unb;
    if (staked <= 0n) return;
    const s = (r.stakedSinceAt ?? r.updatedAt)?.getTime();
    if (s !== undefined && (since === null || s < since)) since = s;
    const l = (r.lastStakedAt ?? r.stakedSinceAt ?? r.updatedAt)?.getTime();
    if (l !== undefined && (last === null || l > last)) last = l;
  };
  for (const p of positions) fold(toYocto(p.stakedSnapshot), toYocto(p.unbondingSnapshot), p);
  for (const m of mocks) fold(toYocto(m.staked), toYocto(m.unbonding), m);
  return { activeStakedYocto: active, unbondingYocto: unbonding, stakedSinceMs: since, lastStakedAtMs: last };
}
