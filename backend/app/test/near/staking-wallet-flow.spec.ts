import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../../src/core/tokens';
import { FlagsService } from '../../src/flags/flags.service';
import { ActionFinisher, OpNonce } from '../../src/near/staking/services/action-finisher';
import { PerksView } from '../../src/near/staking/services/perks-view';
import { StakingTxWriter } from '../../src/near/staking/services/staking-tx.writer';
import { WalletBalances } from '../../src/near/staking/services/wallet-balances';
import { requireWalletAccount, WalletStakeFlow, walletClaimOf } from '../../src/near/staking/services/wallet-stake.flow';
import { StakingPositionSyncService } from '../../src/near/staking/staking-position-sync.service';
import { nearToYocto } from '../../src/near/staking/yocto';
import { InMemoryStaking } from '../../src/near/testing/in-memory-staking';

const POOL = 'astro-stakers.pool.mock';
const DAY = 86_400_000;

function harness() {
  const env = { NODE_ENV: 'test', TA_WAVES: 'all' } as unknown as AppEnv;
  const staking = new InMemoryStaking(undefined, undefined, undefined, undefined, { earlyExitFee: true });
  const flags = new FlagsService(env);
  const positionSync = new StakingPositionSyncService(staking, env, undefined, flags);
  const rows: Array<{ id: string; kind: string; amountYocto: string; accountId: string }> = [];
  const fakeDb = {
    stakingTx: {
      upsert: async ({ where, create }: { where: { id: string }; create: { kind: string; amountYocto: string; accountId: string } }) => {
        if (!rows.some((r) => r.id === where.id)) rows.push({ id: where.id, kind: create.kind, amountYocto: create.amountYocto, accountId: create.accountId });
      },
    },
  };
  const envBag = () => env as unknown as Record<string, string | undefined>;
  const balances = new WalletBalances(staking, () => null);
  const flow = new WalletStakeFlow({
    staking,
    balances,
    finisher: new ActionFinisher(staking, positionSync),
    nonce: new OpNonce(),
    perks: new PerksView(staking, envBag, () => null),
    txs: new StakingTxWriter(() => fakeDb as never),
    env: envBag,
    db: () => null,
  });
  return { staking, flow, rows, fund: (a: string, n: number) => staking.creditNear(a, nearToYocto(n)) };
}

describe('W28-04 WalletStakeFlow (no deed, no claim)', () => {
  it('stakes by wallet account id with zero colonies and answers with V2 perks and no colonyId', async () => {
    const { flow, fund } = harness();
    await fund('zoe.near', 60);
    const res = await flow.stake({ accountId: 'zoe.near', pool: POOL, amount: '50' });
    expect(res.position).toMatchObject({ accountId: 'zoe.near', pool: POOL, staked: '50' });
    expect(res.position.colonyId).toBeUndefined();
    expect(res.walletBalanceNear).toBe('10');
    expect(res.perks).toMatchObject({ version: 2, tier: 2, feeTier: 1, platformFeeBp: 65 });
  });

  it('refuses a request without a wallet (WALLET_REQUIRED) and an unfunded stake (STAKE_INSUFFICIENT_BALANCE)', async () => {
    const { flow } = harness();
    await expect(flow.stake({ pool: POOL, amount: '5' })).rejects.toMatchObject({ errorCode: 'WALLET_REQUIRED', status: 400 });
    await expect(flow.stake({ accountId: '  ', pool: POOL, amount: '5' })).rejects.toMatchObject({ errorCode: 'WALLET_REQUIRED' });
    await expect(flow.stake({ accountId: 'broke.near', pool: POOL, amount: '5' })).rejects.toMatchObject({ errorCode: 'STAKE_INSUFFICIENT_BALANCE' });
  });

  it('charges the 25 bp early-exit fee inside 7 days and nothing after, and drops the tier at once', async () => {
    const { flow, fund, staking, rows } = harness();
    await fund('ann.near', 60);
    await flow.stake({ accountId: 'ann.near', pool: POOL, amount: '50' });
    const early = await flow.unstake({ accountId: 'ann.near', pool: POOL, amount: '45' });
    expect(early.earlyExitFeeBp).toBe(25);
    expect(early.earlyExitFeeNear).toBe('0.1125');
    expect(early.position.unbonding).toBe('44.8875');
    expect(early.perks).toMatchObject({ tier: 0, platformFeeBp: 100 });
    expect(rows.map((r) => r.kind)).toEqual(['stake', 'unstake', 'early_exit_fee']);

    staking.advanceClockMs(8 * DAY);
    await flow.stake({ accountId: 'ann.near', pool: POOL, amount: '5' });
    staking.advanceClockMs(8 * DAY);
    const late = await flow.unstake({ accountId: 'ann.near', pool: POOL, amount: '5' });
    expect(late.earlyExitFeeBp).toBe(0);
    expect(late.earlyExitFeeNear).toBe('0');
  });

  it('withdraws in one step only after unbonding (NOTHING_TO_WITHDRAW before) and records the payout', async () => {
    const { flow, fund, staking, rows } = harness();
    await fund('bob.near', 20);
    await flow.stake({ accountId: 'bob.near', pool: POOL, amount: '20' });
    staking.advanceClockMs(8 * DAY);
    await flow.unstake({ accountId: 'bob.near', pool: POOL, amount: '10' });
    await expect(flow.withdraw({ accountId: 'bob.near', pool: POOL })).rejects.toMatchObject({ errorCode: 'NOTHING_TO_WITHDRAW', status: 409 });
    staking.advanceClockMs(2 * DAY + 1);
    const res = await flow.withdraw({ accountId: 'bob.near', pool: POOL });
    expect(Number(res.walletBalanceNear)).toBeGreaterThanOrEqual(10);
    expect(res.position.withdrawable).toBe('0');
    expect(rows.at(-1)).toMatchObject({ kind: 'withdraw', accountId: 'bob.near' });
  });

  it('compounds accrued yield without moving the deposit clocks, and rejects an empty position', async () => {
    const { flow, fund, staking, rows } = harness();
    await fund('cy.near', 30);
    await expect(flow.compound({ accountId: 'cy.near', pool: POOL })).rejects.toMatchObject({ errorCode: 'NOTHING_TO_COMPOUND', status: 409 });
    const staked = await flow.stake({ accountId: 'cy.near', pool: POOL, amount: '30' });
    staking.advanceClockMs(30 * DAY);
    const res = await flow.compound({ accountId: 'cy.near', pool: POOL });
    expect(Number(res.compoundedNear)).toBeGreaterThan(0);
    expect(Number(res.position.staked)).toBeGreaterThan(30);
    expect(res.position.lastStakedAtMs).toBe(staked.position.lastStakedAtMs);
    expect(rows.map((r) => r.kind)).toEqual(['stake', 'compound']);
  });

  it('replaying an opId writes no second history row (idempotent)', async () => {
    const { flow, fund, rows } = harness();
    await fund('idem.near', 10);
    await flow.stake({ accountId: 'idem.near', pool: POOL, amount: '10', opId: 'same-op' });
    await flow.stake({ accountId: 'idem.near', pool: POOL, amount: '10', opId: 'same-op' });
    expect(rows).toHaveLength(1);
  });

  it('helpers: requireWalletAccount trims, walletClaimOf makes the wallet its own claimant', () => {
    expect(requireWalletAccount(' a.near ')).toBe('a.near');
    expect(() => requireWalletAccount(undefined)).toThrow();
    expect(walletClaimOf('a.near')).toMatchObject({ claimed: true, accountId: 'a.near', claimedByAccountId: 'a.near' });
  });
});
