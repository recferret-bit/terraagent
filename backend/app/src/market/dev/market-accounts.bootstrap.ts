import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { kekEnv } from '../../near/identity/colony-accounts.js';
import { loadKekRing } from '../../near/keystore/kek.js';
import { KeyStore } from '../../near/keystore/keys.js';
import { nearAdapterFor } from '../../near/infrastructure/adapter-selection.js';
import { PLATFORM_ACCOUNT_ID, resolveProtocolAccountId } from '../orders/market-policy.provider.js';
import { resolveTreasurySystemAccountId, TREASURY_ACCOUNT_ID } from '../settlement/treasury-terms.js';

/** Fee beneficiaries every settlement batch touches: they need a custodial key because the verifier batch carries one signed diff per account. */
export const MARKET_SYSTEM_ACCOUNTS: readonly string[] = [PLATFORM_ACCOUNT_ID, TREASURY_ACCOUNT_ID];

/**
 * Dev/demo bootstrap (W13-14): outside real-network production, makes sure the platform and treasury accounts exist with a sealed custodial
 * key (same `chain.near_colony_account` row shape as a colony account, slot `system`), so settlement works without test helpers.
 * Idempotent; a row that exists keeps its key. Skipped in production when `Intents` runs on `mainnet` (`intents.near`).
 */
@Injectable()
export class MarketAccountsBootstrap implements OnModuleInit {
  private readonly log = new Logger(MarketAccountsBootstrap.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!databaseEnabled(this.env)) return;
    const envBag = this.env as unknown as Record<string, string | undefined>;
    if (this.env.NODE_ENV === 'production' && nearAdapterFor('Intents', envBag) === 'mainnet') return;
    try {
      await this.ensure();
    } catch (err) {
      this.log.warn(`market system accounts were not bootstrapped: ${err instanceof Error ? err.message.split('\n').pop() : String(err)}`);
    }
  }

  async ensure(): Promise<void> {
    const envBag = this.env as unknown as Record<string, string | undefined>;
    const accounts = Array.from(
      new Set([
        ...MARKET_SYSTEM_ACCOUNTS,
        resolveProtocolAccountId(envBag),
        resolveTreasurySystemAccountId(envBag),
      ]),
    );
    const keys = new KeyStore(loadKekRing(kekEnv(this.env)));
    for (const accountId of accounts) await ensureCustodialAccount(this.prisma, keys, accountId);
  }
}

/**
 * Idempotent: the mock chain account plus a sealed custodial signing key (a row that exists keeps its key). Dev/demo only.
 * `owner` makes the row a player's colony account (`slot` = the sim colony id, so `GET /v1/market` finds it); default: a system account.
 */
export async function ensureCustodialAccount(prisma: PrismaClient, keys: KeyStore, accountId: string, owner?: { readonly playerId: string; readonly slot: string }): Promise<void> {
  await prisma.mockChainAccount.upsert({ where: { accountId }, create: { accountId, kind: 'system' }, update: {} });
  if (await prisma.nearColonyAccount.findUnique({ where: { accountId }, select: { accountId: true } })) return;
  const g = keys.generate();
  await prisma.nearColonyAccount.upsert({
    where: { accountId },
    create: { accountId, playerId: owner?.playerId ?? `system:${accountId}`, slot: owner?.slot ?? 'system', ownerAccountId: accountId, publicKey: g.row.publicKey, encryptedSecret: g.row.encryptedSecret, kekVersion: g.row.kekVersion },
    update: {},
  });
}
