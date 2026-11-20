import { afterEach, describe, expect, it } from 'vitest';
import { resetPerksDeps, setPerksDeps } from '../../src/near/staking/perks/perks-deps';
import { ActionEffects } from '../../src/near/staking/services/action-effects';
import { ActionFinisher, OpNonce } from '../../src/near/staking/services/action-finisher';
import { PerksView } from '../../src/near/staking/services/perks-view';
import { quoteUsdcToNearYocto, StakeProfitsService } from '../../src/near/staking/services/stake-profits.service';
import { StakingTxWriter } from '../../src/near/staking/services/staking-tx.writer';
import { WalletBalances } from '../../src/near/staking/services/wallet-balances';
import { StakingPositionSyncService } from '../../src/near/staking/staking-position-sync.service';
import { InMemoryStaking } from '../../src/near/testing/in-memory-staking';
import { FlagsService } from '../../src/flags/flags.service';
import type { AppEnv } from '../../src/core/tokens';

const POOL = 'astro-stakers.pool.mock';

function service(envOver: Record<string, string> = {}) {
  const raw = { NODE_ENV: 'test', TA_WAVES: 'all', ...envOver };
  const env = raw as unknown as AppEnv;
  const staking = new InMemoryStaking();
  const positionSync = new StakingPositionSyncService(staking, env, undefined, new FlagsService(env));
  const envBag = () => raw as Record<string, string | undefined>;
  return new StakeProfitsService({
    staking,
    balances: new WalletBalances(staking, () => null),
    finisher: new ActionFinisher(staking, positionSync),
    nonce: new OpNonce(),
    perks: new PerksView(staking, envBag, () => null),
    effects: new ActionEffects(staking, new StakingTxWriter(() => null)),
    env: envBag,
    db: () => null,
  });
}

afterEach(() => resetPerksDeps());

describe('W28-04 USDC -> NEAR profit quote', () => {
  it('prices 10 USDC at $4 as 2.5 NEAR (pure bigint, floored)', () => {
    expect(quoteUsdcToNearYocto(10_000_000n, 4)).toBe(2_500_000_000_000_000_000_000_000n);
    expect(quoteUsdcToNearYocto(1n, 4)).toBe(250_000_000_000_000_000n);
    expect(quoteUsdcToNearYocto(1_000_000n, 3.333333)).toBe((10n ** 24n * 1_000_000n) / 3_333_333n);
  });

  it('rejects a non-positive price instead of dividing by zero', () => {
    expect(() => quoteUsdcToNearYocto(1_000_000n, 0)).toThrow(/price/);
    expect(() => quoteUsdcToNearYocto(1_000_000n, -2)).toThrow();
  });
});

describe('W28-04 StakeProfitsService', () => {
  it('on a real network it is quote-only: dry, no tx hash, no position (nothing moves)', async () => {
    const res = await service({ NEAR_MODE: 'testnet' }).run({ accountId: 'q.near', amountUsdc: '10', asset: 'stNEAR' });
    expect(res.txHash).toBeNull();
    expect(res.position).toBeNull();
    expect(res.quote).toMatchObject({ amountOutNear: '2.5', nearUsd: 4, dry: true, amountInAtomic: '10000000' });
  });

  it('quotes at the price provider W28-05 plugs in', async () => {
    setPerksDeps({ priceProvider: { nearUsd: async () => 5 } });
    const res = await service().run({ accountId: 'q.near', amountUsdc: '10', dry: true });
    expect(res.quote).toMatchObject({ amountOutNear: '2', nearUsd: 5 });
  });

  it('rejects zero, malformed, and over-precise amounts and a missing wallet', async () => {
    const svc = service();
    await expect(svc.run({ accountId: 'q.near', amountUsdc: '0' })).rejects.toMatchObject({ errorCode: 'NEAR_INVALID_INPUT', status: 400 });
    await expect(svc.run({ accountId: 'q.near', amountUsdc: '01' })).rejects.toMatchObject({ errorCode: 'NEAR_INVALID_INPUT' });
    await expect(svc.run({ accountId: 'q.near', amountUsdc: '1.1234567' })).rejects.toMatchObject({ errorCode: 'NEAR_INVALID_INPUT' });
    await expect(svc.run({ amountUsdc: '5' })).rejects.toMatchObject({ errorCode: 'WALLET_REQUIRED' });
  });

  it('refuses an unknown pool, and an adapter without the atomic swap-and-stake call', async () => {
    const svc = service();
    await expect(svc.run({ accountId: 'q.near', amountUsdc: '5', pool: 'nope.pool.mock', dry: true })).rejects.toMatchObject({ errorCode: 'POOL_NOT_WHITELISTED' });
    await expect(svc.run({ accountId: 'q.near', amountUsdc: '5', pool: POOL })).rejects.toMatchObject({ errorCode: 'NEAR_UNAVAILABLE' });
  });
});
