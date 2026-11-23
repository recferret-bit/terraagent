import { MARKET_TOKENS, toChainUnits } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { devPlayerId } from '../../../ws/session-verifier.js';
import { isLocalStakingFastTimings } from '../../staking/local-staking-timings.js';
import { NEAR_TOKEN_ID, nearToYocto, yoctoToNear } from '../../staking/yocto.js';
import { creditVerifier } from '../adapters/mock/intents-ledger.js';
import { nearAdapterFor } from '../adapter-selection.js';

type EnvBag = Readonly<Record<string, string | undefined>>;

export const LOCAL_MOCK_STARTER_NEAR = '1000';
export const LOCAL_MOCK_STARTER_USDC_ATOMIC = 250_000_000n;
export const LOCAL_MOCK_FAUCET_NEAR = '500';
export const LOCAL_MOCK_FAUCET_USDC_ATOMIC = 100_000_000n;
export const LOCAL_MOCK_DEFAULT_PLANET_ID = 'pl_local_prime';

function canSeedMockStaking(prisma: PrismaClient | null | undefined, env: EnvBag): prisma is PrismaClient {
  if (!prisma || env.NODE_ENV === 'production') return false;
  if (env.NODE_ENV === 'test' && !env.DATABASE_URL && '$connect' in prisma) return false;
  return nearAdapterFor('Staking', env) === 'mock' && nearAdapterFor('Intents', env) === 'mock';
}

export interface LocalSeedPlanetHint {
  readonly id: string;
  readonly name?: string;
}

async function ensureOpenLocalPlanet(prisma: PrismaClient, extraPlanet?: LocalSeedPlanetHint): Promise<string> {
  if (typeof prisma.planet?.upsert === 'function') {
    await prisma.planet.upsert({
      where: { id: LOCAL_MOCK_DEFAULT_PLANET_ID },
      create: { id: LOCAL_MOCK_DEFAULT_PLANET_ID, name: 'Local Prime', admission: 'OPEN' },
      update: { admission: 'OPEN' },
    });
    const extraId = extraPlanet?.id?.trim();
    if (extraId && extraId !== LOCAL_MOCK_DEFAULT_PLANET_ID) {
      await prisma.planet.upsert({
        where: { id: extraId },
        create: { id: extraId, name: extraPlanet?.name?.trim() || extraId, admission: 'OPEN' },
        update: {},
      });
    }
  }
  if (typeof prisma.planet?.findFirst !== 'function') return LOCAL_MOCK_DEFAULT_PLANET_ID;
  const existing = await prisma.planet.findFirst({
    where: { id: LOCAL_MOCK_DEFAULT_PLANET_ID, admission: { not: 'ARCHIVED' } },
    select: { id: true },
  });
  return existing?.id ?? LOCAL_MOCK_DEFAULT_PLANET_ID;
}

async function addMockNear(prisma: PrismaClient, accountId: string, amountNear: string): Promise<bigint> {
  const deltaYocto = BigInt(nearToYocto(amountNear));
  await prisma.mockChainAccount.upsert({
    where: { accountId },
    create: { accountId, kind: 'named' },
    update: {},
  });
  await prisma.$executeRaw`INSERT INTO chain.mock_chain_balance (account_id, token_id, amount)
    VALUES (${accountId}, ${NEAR_TOKEN_ID}, ${deltaYocto.toString()}::numeric)
    ON CONFLICT (account_id, token_id) DO UPDATE SET amount = chain.mock_chain_balance.amount + EXCLUDED.amount`;
  const row = await prisma.mockChainBalance.findUnique({
    where: { accountId_tokenId: { accountId, tokenId: NEAR_TOKEN_ID } },
  });
  return BigInt(row?.amount.toFixed(0) ?? '0');
}

/**
 * One-time starter funding for a local pilot wallet on mock Staking/Intents (`.mock` accounts, or any linked wallet
 * while fast local staking mode is active) so Stake and Stake Trade Profits work out of the box without touching
 * wallets that were already funded or have active/past staking rows.
 */
export async function ensureLocalMockStarterFunds(
  prisma: PrismaClient | null | undefined,
  accountId: string,
  env: EnvBag = process.env,
  extraPlanet?: LocalSeedPlanetHint,
): Promise<void> {
  const clean = accountId.trim();
  if (!clean || !(clean.endsWith('.mock') || isLocalStakingFastTimings(env)) || !canSeedMockStaking(prisma, env)) return;
  if (typeof prisma.mockChainBalance?.findUnique !== 'function') return;
  const [bal, stk] = await Promise.all([
    prisma.mockChainBalance.findUnique({ where: { accountId_tokenId: { accountId: clean, tokenId: NEAR_TOKEN_ID } } }),
    prisma.mockChainStaking?.findFirst ? prisma.mockChainStaking.findFirst({ where: { accountId: clean } }) : null,
  ]);
  await ensureOpenLocalPlanet(prisma, extraPlanet);
  if (bal || stk) return;
  await addMockNear(prisma, clean, LOCAL_MOCK_STARTER_NEAR);
  await creditVerifier(prisma, clean, MARKET_TOKENS.USDC.verifierId, toChainUnits('USDC', LOCAL_MOCK_STARTER_USDC_ATOMIC));
}

export interface LocalMockFaucetResult {
  readonly ok: true;
  readonly accountId: string;
  readonly addedNear: string;
  readonly addedUsdc: string;
  readonly walletBalanceNear: string;
  readonly defaultPlanetId: string;
}

export async function creditLocalMockFaucet(
  prisma: PrismaClient,
  accountId: string,
  env: EnvBag = process.env,
): Promise<LocalMockFaucetResult | null> {
  const clean = accountId.trim();
  if (!clean || !canSeedMockStaking(prisma, env)) return null;
  const [nextYocto, defaultPlanetId] = await Promise.all([
    addMockNear(prisma, clean, LOCAL_MOCK_FAUCET_NEAR),
    ensureOpenLocalPlanet(prisma),
  ]);
  await creditVerifier(prisma, clean, MARKET_TOKENS.USDC.verifierId, toChainUnits('USDC', LOCAL_MOCK_FAUCET_USDC_ATOMIC));
  return {
    ok: true,
    accountId: clean,
    addedNear: LOCAL_MOCK_FAUCET_NEAR,
    addedUsdc: '100.00',
    walletBalanceNear: yoctoToNear(nextYocto, 6),
    defaultPlanetId,
  };
}

/**
 * In local dev (`TA_LOCAL_STAKING_TIMINGS=1` / `NEAR_MODE=local`), links `/me.html?as=<slug>`'s `Bearer dev:<slug>`
 * identity (`devPlayerId(slug)`) to `<slug>.terraagent.mock` so `WalletControlGuard` authorizes staking actions.
 */
export async function ensureLocalDevAliasWallet(
  prisma: PrismaClient | null | undefined,
  rawSlug: string,
  accountId: string,
  env: EnvBag = process.env,
  extraPlanet?: LocalSeedPlanetHint,
): Promise<void> {
  const slug = rawSlug.trim().toLowerCase();
  const cleanAcct = accountId.trim();
  if (!slug || !cleanAcct.endsWith('.mock') || !canSeedMockStaking(prisma, env) || !isLocalStakingFastTimings(env)) {
    return;
  }
  if (typeof prisma.socialIdentity?.findFirst !== 'function' || typeof prisma.player?.upsert !== 'function') return;
  const aliasId = devPlayerId(slug);
  const existing = await prisma.socialIdentity.findFirst({
    where: { playerId: aliasId, accountId: cleanAcct },
    select: { id: true },
  });
  if (!existing) {
    const taken = await prisma.socialIdentity.findFirst({ where: { accountId: cleanAcct }, select: { playerId: true } });
    if (!taken) {
      const handleClash = prisma.player.findUnique
        ? await prisma.player.findUnique({ where: { handle: slug }, select: { id: true } }).catch(() => null)
        : null;
      const safeHandle = slug === 'w12' || (handleClash && handleClash.id !== aliasId) ? `dev_${slug}` : slug;
      await prisma.player.upsert({
        where: { id: aliasId },
        create: { id: aliasId, handle: safeHandle },
        update: {},
      }).catch(() => undefined);
      await prisma.socialIdentity.upsert({
        where: { provider_subject: { provider: 'local-mock', subject: `dev:${slug}` } },
        create: {
          id: `si_dev_${slug}`,
          playerId: aliasId,
          provider: 'local-mock',
          subject: `dev:${slug}`,
          accountId: cleanAcct,
        },
        update: {},
      }).catch(() => undefined);
    }
  }
  await ensureLocalMockStarterFunds(prisma, cleanAcct, env, extraPlanet);
}
