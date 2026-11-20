import {
  MARKET_TOKENS,
  parseDecimalToAtomic,
  StakeProfitsResponse,
  STAKING_RULES,
  type Nep413Signature,
  type StakeProfitsQuote,
  type StakeProfitsRequest,
} from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { StakingPort } from '../../application/ports/staking.port.js';
import { NearException } from '../../domain/errors.js';
import { IntentsBalanceReadPort } from '../../application/ports/intents-balance-read.port.js';
import { nearAdapterFor } from '../../infrastructure/adapter-selection.js';
import { resolvePerksDeps } from '../perks/perks-deps.js';
import { verifyStakingWalletSignature, type FullAccessKeyVerifier } from '../staking-signature-guard.js';
import { ONE_NEAR_YOCTO, yoctoToNear } from '../yocto.js';
import type { ActionFinisher, OpNonce } from './action-finisher.js';
import type { PerksView } from './perks-view.js';
import { stakingNowMs } from './port-hooks.js';
import { requireWalletAccount, walletClaimOf } from './wallet-stake.flow.js';
import type { StakingTxWriter } from './staking-tx.writer.js';
import type { WalletBalances } from './wallet-balances.js';

const USDC_DECIMALS = MARKET_TOKENS.USDC.decimals;
const USDC_ATOMIC_PER_USD = 10n ** BigInt(USDC_DECIMALS);

function parseUsdc(text: string): bigint {
  try {
    return parseDecimalToAtomic(text, USDC_DECIMALS, 'USDC');
  } catch (err) {
    throw new NearException('NEAR_INVALID_INPUT', { message: err instanceof Error ? err.message : 'Invalid USDC amount.' });
  }
}

export interface StakeProfitsDeps {
  readonly staking: StakingPort;
  readonly balances: WalletBalances;
  readonly finisher: ActionFinisher;
  readonly nonce: OpNonce;
  readonly perks: PerksView;
  readonly txs: StakingTxWriter;
  readonly env: () => Record<string, string | undefined>;
  readonly db: () => PrismaClient | null;
  readonly keyVerifier?: FullAccessKeyVerifier;
  /** Verifier (`intents.near`) balances: where a wallet's USDC trade profit sits. */
  readonly intentsRead?: IntentsBalanceReadPort;
}

/**
 * `USDC` yocto-NEAR out for `usdcAtomic` in at `nearUsd` (USD per NEAR, rounded to a micro-dollar):
 * `usdc / 1e6 USD / price * 1e24 yocto`. Pure bigint math, floored.
 */
export function quoteUsdcToNearYocto(usdcAtomic: bigint, nearUsd: number): bigint {
  const priceMicro = BigInt(Math.round(nearUsd * Number(USDC_ATOMIC_PER_USD)));
  if (priceMicro <= 0n) throw new NearException('NEAR_INVALID_INPUT', { message: 'NEAR/USD price must be positive.' });
  return (usdcAtomic * ONE_NEAR_YOCTO) / priceMicro;
}

/**
 * `POST /v1/near/stake/profits`: quotes the wallet's `USDC` trade profit in NEAR at the cached `NEAR/USD` price (the perks
 * price provider, default `STAKING_RULES.estNearUsd`; W28-05 plugs a live one in) and, on the mock chain, debits the USDC,
 * swaps it to `stNEAR` and stakes it in ONE adapter call (atomic, replay-safe by `opId`). Real networks are quote-only
 * (`dry: true`, `txHash: null`, nothing moves).
 */
export class StakeProfitsService {
  constructor(private readonly d: StakeProfitsDeps) {}

  async run(input: StakeProfitsRequest & { readonly signature?: Nep413Signature; readonly asset?: 'near' | 'stNEAR' | 'LiNEAR' }): Promise<StakeProfitsResponse> {
    const accountId = requireWalletAccount(input.accountId);
    const sig = input.walletSignature ?? input.signature;
    const usdcAtomic = parseUsdc(input.amountUsdc);
    if (usdcAtomic <= 0n) {
      throw new NearException('NEAR_INVALID_INPUT', { message: 'Profit stake amount must be greater than zero.' });
    }
    const nearUsd = Number(await resolvePerksDeps().priceProvider.nearUsd()) || STAKING_RULES.estNearUsd;
    const nearYocto = quoteUsdcToNearYocto(usdcAtomic, nearUsd);
    const pool = await this.resolvePool(input.pool);
    const dry = input.dry === true || nearAdapterFor('Staking', this.d.env()) !== 'mock';
    const quote: StakeProfitsQuote = {
      amountInUsdc: input.amountUsdc,
      amountInAtomic: usdcAtomic.toString(),
      amountOutNear: yoctoToNear(nearYocto, 6),
      nearUsd,
      source: 'mock',
      dry,
    };
    if (dry) return this.respond(quote, null, null, accountId);

    // A quote moves nothing, so only the executing path needs the wallet's signature (a no-op on the mock chain).
    await this.verifySignature(accountId, sig, input);
    if (!this.d.staking.stakeProfits) {
      throw new NearException('NEAR_UNAVAILABLE', { message: 'This staking adapter cannot swap and stake USDC profits.' });
    }
    const opId = input.opId?.trim() || `stake_profits:${accountId}:${sig?.nonce ?? this.d.nonce.next()}`;
    const asset = input.asset ?? 'stNEAR';
    const payerAccountId = await this.pickUsdcPayer(accountId, usdcAtomic);
    const receipt = await this.d.staking.stakeProfits({
      opId,
      accountId,
      ...(payerAccountId !== accountId ? { payerAccountId } : {}),
      pool,
      usdcAtomic: usdcAtomic.toString(),
      nearYocto: nearYocto.toString(),
      asset,
    });
    await this.d.txs.record({
      kind: 'stake_profits',
      accountId,
      poolId: pool,
      asset,
      amountYocto: nearYocto,
      txHash: receipt.txHash,
      opId,
      atMs: stakingNowMs(this.d.staking),
    });
    const position = await this.d.finisher.positionAfter(accountId, pool);
    return this.respond(quote, receipt.txHash, position, accountId);
  }

  private async respond(
    quote: StakeProfitsQuote,
    txHash: string | null,
    position: Awaited<ReturnType<ActionFinisher['positionAfter']>> | null,
    accountId: string,
  ): Promise<StakeProfitsResponse> {
    const positions = position ? [position] : [];
    const perks = await this.d.perks.evaluate({
      accountId,
      grossApyBp: position?.apyBp ?? STAKING_RULES.simGrossApyBp,
      positions,
    });
    return StakeProfitsResponse.parse({
      quote,
      txHash,
      position,
      walletBalanceNear: await this.d.balances.readNear(accountId),
      perks,
    });
  }

  /** The `stNEAR` pool: the requested one, else the first whitelisted pool. */
  private async resolvePool(requested?: string): Promise<string> {
    const pools = await this.d.staking.listPools();
    const pool = requested ? pools.find((p) => p.poolId === requested) : pools[0];
    if (!pool) throw new NearException('POOL_NOT_WHITELISTED', { details: { pool: requested ?? null } });
    return pool.poolId;
  }

  /**
   * The verifier ledger holds a wallet's trade profit on the account that traded: the wallet itself or one of its
   * colony accounts (`near_colony_account` rows owned / claimed by the wallet). The first with enough USDC pays.
   */
  private async pickUsdcPayer(accountId: string, usdcAtomic: bigint): Promise<string> {
    const db = this.d.db();
    const read = this.d.intentsRead;
    if (!db || !read) return accountId;
    const usdcId = MARKET_TOKENS.USDC.verifierId;
    const rows = await db.nearColonyAccount.findMany({
      where: { OR: [{ ownerAccountId: accountId }, { claimedByAccountId: accountId }] },
      select: { accountId: true },
    });
    for (const candidate of [accountId, ...rows.map((r) => r.accountId)]) {
      if ((await read.verifierChainBalance(candidate, usdcId)) >= usdcAtomic) return candidate;
    }
    return accountId;
  }

  private verifySignature(accountId: string, sig: Nep413Signature | undefined, input: StakeProfitsRequest): Promise<void> {
    return verifyStakingWalletSignature({
      sig,
      action: 'stake_profits',
      colonyId: accountId,
      claimInfo: walletClaimOf(accountId),
      poolId: input.pool ?? '',
      amount: input.amountUsdc,
      envMap: this.d.env(),
      keyVerifier: this.d.keyVerifier,
      prisma: this.d.db(),
    });
  }
}
