import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { aggregateLegs, type Leg, type TreasuryTerms } from '@terra/sim/systems/trade/market-batch';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { TreasuryDaoPort } from '../../near/application/ports/treasury-dao.port.js';
import { nearAdapterFor } from '../../near/infrastructure/adapter-selection.js';
import { kekEnv } from '../../near/identity/colony-accounts.js';
import { loadKekRing } from '../../near/keystore/kek.js';
import { KeyStore } from '../../near/keystore/keys.js';
import { daoAccountIdFor } from '../../near/treasury/policy.js';
import { ensureCustodialAccount } from '../dev/market-accounts.bootstrap.js';
import { MarketPolicyProvider, resolveProtocolAccountId } from '../orders/market-policy.provider.js';
import type { TradePlan } from './trade-plan.js';
import {
  resolveTreasurySystemAccountId,
  treasuryBatchAccount,
  treasuryFeeOpId,
  treasuryTerms,
} from './treasury-terms.js';

const missingDao = (e: unknown): boolean => {
  const code = (e as { errorCode?: string }).errorCode;
  return code === 'DAO_NOT_FOUND' || code === 'NEAR_DAO_NOT_FOUND';
};

/**
 * W22-07: terms for the batch, a signer for the carve-out leg, and the DAO credit after FINAL.
 * A missing DAO never fails the trade. `deposit` runs only when `TreasuryDaoPort.get` succeeds.
 */
@Injectable()
export class TreasuryFeeService {
  private keys: KeyStore | null = null;

  constructor(
    private readonly flags: FlagsService,
    private readonly policy: MarketPolicyProvider,
    private readonly daos: TreasuryDaoPort,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  /** `enabled` follows W22. The account is the planet DAO, or `treasury:{planetId}` when get misses. */
  async termsFor(planetId: string): Promise<TreasuryTerms> {
    const row = this.policy.current();
    if (!this.flags.has('W22')) return treasuryTerms(this.flags, row, treasuryBatchAccount(planetId, null));
    return treasuryTerms(this.flags, row, treasuryBatchAccount(planetId, await this.daoAccount(planetId)));
  }

  /**
   * Legs the verifier can sign. A label with no key is signed by `treasury.terraagent.mock` in production so the
   * fill still settles. Dev and test seal a key for the batch account, so the verifier credit matches the stored leg.
   */
  async legsToSign(legs: readonly Leg[], treasuryAccountId: string | null): Promise<readonly Leg[]> {
    if (!treasuryAccountId || !legs.some((l) => l.accountId === treasuryAccountId)) return legs;
    const signer = await this.signerFor(treasuryAccountId);
    if (signer === treasuryAccountId) return legs;
    return aggregateLegs(legs.map((l) => (l.accountId === treasuryAccountId ? { ...l, accountId: signer } : l)));
  }

  /** Credits the planet DAO by the carved share, once per trade. No DAO, or a zero share: no-op. */
  async depositSettled(plan: Pick<TradePlan, 'tradeId' | 'planetId' | 'quote' | 'treasuryFee'>): Promise<void> {
    const amount = plan.treasuryFee ?? '0';
    if (amount === '0') return;
    const daoAccountId = await this.daoAccount(plan.planetId);
    if (!daoAccountId) return;
    await this.daos.deposit({
      opId: treasuryFeeOpId(plan.tradeId),
      daoAccountId,
      from: resolveProtocolAccountId(this.env as unknown as Record<string, string | undefined>),
      tokenId: plan.quote,
      amount,
    });
  }

  private async daoAccount(planetId: string): Promise<string | null> {
    try {
      const envBag = this.env as unknown as Record<string, string | undefined>;
      const view = await this.daos.get({ daoAccountId: daoAccountIdFor(planetId, envBag) });
      return view.daoAccountId;
    } catch (e) {
      if (missingDao(e)) return null;
      throw e;
    }
  }

  private async signerFor(accountId: string): Promise<string> {
    if (await this.hasKey(accountId)) return accountId;
    const envBag = this.env as unknown as Record<string, string | undefined>;
    if (this.env.NODE_ENV === 'production' || nearAdapterFor('Intents', envBag) === 'mainnet') {
      return resolveTreasurySystemAccountId(envBag);
    }
    await ensureCustodialAccount(this.prisma, this.ring(), accountId);
    return accountId;
  }

  private hasKey(accountId: string): Promise<boolean> {
    return this.prisma.nearColonyAccount.findUnique({ where: { accountId }, select: { accountId: true } }).then((row) => row !== null);
  }

  private ring(): KeyStore {
    this.keys ??= new KeyStore(loadKekRing(kekEnv(this.env)));
    return this.keys;
  }
}
