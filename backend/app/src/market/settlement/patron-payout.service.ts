import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { isPatronageEligiblePlanetId, MARKET_TOKENS, toChainUnits } from '@terra/contracts';
import { withTransaction, type PrismaClient } from '@terra/db';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { nearAdapterFor } from '../../near/infrastructure/adapter-selection.js';
import { splitPlatformFee } from '../../near/infrastructure/network/protocol-fee.config.js';
import { PatronSeatService } from '../../near/staking/perks/patron-seat.service.js';
import { MarketPolicyProvider, resolveProtocolAccountId } from '../orders/market-policy.provider.js';
import type { TradePlan } from './trade-plan.js';

/** Row id of one fill's patron payout: the primary key makes a replay of the same trade a no-op. */
export const patronPayoutId = (tradeId: string): string => `pp:${tradeId}`;

export interface PatronPayoutResult {
  readonly planetId: string;
  readonly accountId: string;
  readonly amountUsdcAtomic: bigint;
  readonly created: boolean;
}

/**
 * W28-06 King-of-the-Hill payout. On every FINAL fill of a planet that has a Lead Patron, the platform fee is split by
 * `splitPlatformFee(..., { patronActive: true })` (DAO 20 %, Patron 15 % of the rest = 12 % of gross, Protocol 68 %) and
 * the Patron's cut is recorded in `chain.staking_patron_payout` (USDC atomic, `sourceTradeId`, idempotent per trade).
 * It runs from `TreasuryFeeService.depositSettled`, next to the W22 DAO carve-out, never from a second path.
 * Only USDC-quoted fills pay out (NEAR and barter fees are not USDC); `W28` off records nothing.
 */
@Injectable()
export class PatronPayoutService {
  private readonly log = new Logger(PatronPayoutService.name);

  constructor(
    private readonly flags: FlagsService,
    private readonly policy: MarketPolicyProvider,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {}

  async record(plan: Pick<TradePlan, 'tradeId' | 'planetId' | 'quote' | 'treasuryFee'> & Partial<Pick<TradePlan, 'platformFee'>>): Promise<PatronPayoutResult | null> {
    if (!this.flags.has('W28') || plan.quote !== 'USDC' || !isPatronageEligiblePlanetId(plan.planetId)) return null;
    const gross = BigInt(plan.platformFee || '0');
    if (gross <= 0n) return null;
    const seat = await new PatronSeatService(this.prisma).getSeat(plan.planetId);
    if (!seat) return null;
    const carved = BigInt(plan.treasuryFee ?? '0') > 0n;
    const { patron } = splitPlatformFee(gross, { daoShareBp: carved ? this.policy.current().treasuryShareBp : 0, patronActive: true });
    if (patron <= 0n) return null;
    const envBag = (this.env ?? process.env) as unknown as Record<string, string | undefined>;
    const settleMockLedger = nearAdapterFor('Intents', envBag) === 'mock';
    const protocolAccountId = resolveProtocolAccountId(envBag);
    const chainUnits = toChainUnits('USDC', patron);
    const run = async (tx: PrismaClient) => {
      const { count } = await tx.stakingPatronPayout.createMany({
        data: [{ id: patronPayoutId(plan.tradeId), planetId: plan.planetId, accountId: seat.accountId, amountUsdcAtomic: patron.toString(), sourceTradeId: plan.tradeId }],
        skipDuplicates: true,
      });
      if (count === 1 && settleMockLedger && typeof tx.$executeRaw === 'function') {
        const tokenId = MARKET_TOKENS.USDC.verifierId;
        const debited = await tx.$executeRaw`UPDATE chain.mock_chain_intents_balance SET amount = amount - ${chainUnits.toString()}::numeric
          WHERE account_id = ${protocolAccountId} AND token_id = ${tokenId} AND amount >= ${chainUnits.toString()}::numeric`;
        if (debited === 1) {
          await tx.$executeRaw`INSERT INTO chain.mock_chain_intents_balance (account_id, token_id, amount) VALUES (${seat.accountId}, ${tokenId}, ${chainUnits.toString()}::numeric)
            ON CONFLICT (account_id, token_id) DO UPDATE SET amount = chain.mock_chain_intents_balance.amount + EXCLUDED.amount`;
        }
      }
      return count;
    };
    const count = '$transaction' in this.prisma && typeof this.prisma.$transaction === 'function'
      ? await withTransaction(this.prisma, (tx) => run(tx as unknown as PrismaClient))
      : await run(this.prisma);
    return { planetId: plan.planetId, accountId: seat.accountId, amountUsdcAtomic: patron, created: count === 1 };
  }

  /** Never fails a settlement: the fill is already FINAL when this runs. */
  async recordSafely(plan: Parameters<PatronPayoutService['record']>[0]): Promise<void> {
    await this.record(plan).catch((e: unknown) => this.log.warn(`patron payout not recorded: ${e instanceof Error ? e.message : String(e)}`));
  }
}
