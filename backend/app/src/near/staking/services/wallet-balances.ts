import type { PrismaClient } from '@terra/db';
import type { StakingPort } from '../../application/ports/staking.port.js';
import { NEAR_TOKEN_ID, nearToYocto, yoctoToNear } from '../yocto.js';
import { portHooks } from './port-hooks.js';

export interface FundWalletNearResult {
  readonly accountId: string;
  readonly walletBalanceNear: string;
  readonly walletBalanceYocto: string;
}

/**
 * Plain NEAR balances of staking wallets: the adapter's `nearBalanceOf` hook, else `chain.mock_chain_balance`, else an
 * in-memory fallback. Also funds mock wallets (`stake.fund` dev command, tests). Never touches `@terra/sim` (D-31).
 */
export class WalletBalances {
  readonly cache = new Map<string, bigint>();

  constructor(
    private readonly staking: StakingPort,
    private readonly db: () => PrismaClient | null,
  ) {}

  async fund(accountId: string, amountNear: string | number): Promise<FundWalletNearResult> {
    const normAccountId = accountId.trim() || 'col_0.pilot.terraagent.mock';
    const deltaYocto = BigInt(nearToYocto(amountNear));
    const hooks = portHooks(this.staking);
    const db = this.db();

    if (hooks.creditNear) {
      await hooks.creditNear(normAccountId, deltaYocto.toString());
    } else if (db) {
      await db.mockChainAccount.upsert({
        where: { accountId: normAccountId },
        create: { accountId: normAccountId, kind: 'colony' },
        update: {},
      });
      await db.$executeRaw`INSERT INTO chain.mock_chain_balance (account_id, token_id, amount)
        VALUES (${normAccountId}, ${NEAR_TOKEN_ID}, ${deltaYocto.toString()}::numeric)
        ON CONFLICT (account_id, token_id) DO UPDATE SET amount = chain.mock_chain_balance.amount + EXCLUDED.amount`;
    }

    const portBal = await this.readPortOrDb(normAccountId);
    const nextYocto = portBal !== null ? portBal : (this.cache.get(normAccountId) ?? 0n) + deltaYocto;
    this.cache.set(normAccountId, nextYocto);
    return {
      accountId: normAccountId,
      walletBalanceNear: yoctoToNear(nextYocto, 6),
      walletBalanceYocto: nextYocto.toString(),
    };
  }

  /** Sum of the distinct non-empty `candidates`, formatted as NEAR. */
  async readNear(candidates: string | readonly (string | null | undefined)[]): Promise<string> {
    const list = typeof candidates === 'string' ? [candidates] : candidates;
    const unique = Array.from(new Set(list.map((c) => c?.trim()).filter((c): c is string => Boolean(c))));
    let total = 0n;
    for (const acct of unique) {
      const bal = await this.readSingle(acct);
      this.cache.set(acct, bal);
      total += bal;
    }
    return yoctoToNear(total, 6);
  }

  async readSingle(accountId: string): Promise<bigint> {
    const portOrDb = await this.readPortOrDb(accountId);
    if (portOrDb !== null) return portOrDb;
    return this.cache.get(accountId) ?? 0n;
  }

  /** The first candidate that holds `neededYocto`, else the first candidate (the stake then fails on its own balance). */
  async pickPayer(candidates: readonly (string | null | undefined)[], neededYocto: bigint): Promise<string> {
    const unique = Array.from(new Set(candidates.map((c) => c?.trim()).filter((c): c is string => Boolean(c))));
    const primary = unique[0] ?? 'col_0.pilot.terraagent.mock';
    for (const candidate of unique) {
      if ((await this.readSingle(candidate)) >= neededYocto) return candidate;
    }
    return primary;
  }

  private async readPortOrDb(accountId: string): Promise<bigint | null> {
    const hooks = portHooks(this.staking);
    if (hooks.nearBalanceOf) return BigInt((await hooks.nearBalanceOf(accountId)) || '0');
    const db = this.db();
    if (db) {
      const row = await db.mockChainBalance.findUnique({
        where: { accountId_tokenId: { accountId, tokenId: NEAR_TOKEN_ID } },
      });
      return BigInt(row?.amount.toFixed(0) ?? '0');
    }
    return null;
  }
}
