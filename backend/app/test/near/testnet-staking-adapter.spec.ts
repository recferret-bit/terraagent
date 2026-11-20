import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../../src/core/tokens';
import { TestnetStakingAdapter } from '../../src/near/infrastructure/adapters/real/testnet-staking.adapter';
import type { StakingRpc } from '../../src/near/infrastructure/adapters/real/testnet-staking-reads';
import { finalValueOf, mapAccountPosition } from '../../src/near/infrastructure/adapters/real/testnet-staking-reads';
import { StakingRpcError } from '../../src/near/infrastructure/adapters/real/staking-rpc-error';
import { toNearException } from '../../src/near/infrastructure/rpc/near-error-map';

const POOL = 'astro-stakers.pool.testnet';
const STAKING = 'staking.terraagent.testnet';
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');

interface Fake extends StakingRpc {
  readonly calls: Array<{ methodName: string; args: Record<string, unknown>; contractId: string }>;
  readonly views: Array<{ contractId: string; methodName: string; args: Record<string, unknown> }>;
}

/** A fake RPC: records calls, never touches a network, so no test can send a transaction. */
function fakeRpc(opts: {
  views?: Record<string, unknown | (() => unknown)>;
  outcome?: unknown;
  balance?: () => Promise<string>;
} = {}): Fake {
  const calls: Fake['calls'] = [];
  const views: Fake['views'] = [];
  return {
    network: 'testnet',
    config: { contracts: { staking: STAKING }, accounts: { minter: 'minter.testnet' }, secrets: { minterSecretKey: 'ed25519:fake' } },
    calls,
    views,
    async view<T>(contractId: string, methodName: string, args: Record<string, unknown> = {}) {
      views.push({ contractId, methodName, args });
      const v = opts.views?.[methodName];
      if (typeof v === 'function') return (v as () => T)();
      return v as T;
    },
    async call(params) {
      calls.push({ methodName: params.methodName, args: params.args, contractId: params.contractId });
      return { receipt: { txHash: `H${calls.length}`, status: 'success' as const, network: 'testnet' as const, at: 1 }, outcome: opts.outcome ?? { status: { SuccessValue: '' } } };
    },
    accountBalanceYocto: opts.balance ?? (async () => '0'),
  };
}

const env = (over: Record<string, string> = {}) => ({ NODE_ENV: 'test', NEAR_MODE: 'testnet', TA_WAVES: 'all', ...over }) as unknown as AppEnv;
const adapter = (rpc: StakingRpc, over: Record<string, string> = {}) => new TestnetStakingAdapter(env(over), rpc);

const position = (over: Record<string, unknown> = {}) => ({
  account_id: 'w.testnet', pool_id: POOL, staked: '100', unbonding: '0', unbonding_ready_at_ms: null, withdrawable: '40', rewards: '5', ...over,
});

describe('W28-04 TestnetStakingAdapter V2 (fake RPC)', () => {
  it('compound sends compound_yield for the pool and wallet; STAKE_NO_YIELD maps to NOTHING_TO_COMPOUND', async () => {
    const rpc = fakeRpc();
    const receipt = await adapter(rpc).compound({ opId: 'c1', accountId: 'w.testnet', pool: POOL });
    expect(receipt.txHash).toBe('H1');
    expect(rpc.calls[0]).toMatchObject({ methodName: 'compound_yield', contractId: STAKING, args: { pool_id: POOL, account_id: 'w.testnet' } });
    expect(toNearException(new Error('Smart contract panicked: STAKE_NO_YIELD: no accrued yield to compound'))).toMatchObject({ errorCode: 'NOTHING_TO_COMPOUND', status: 409 });
    await expect(adapter(rpc).compound({ opId: 'c2', accountId: 'w.testnet', pool: 'other.pool.testnet' })).rejects.toMatchObject({ errorCode: 'POOL_NOT_WHITELISTED' });
    expect(rpc.calls).toHaveLength(1);
  });

  it('withdraw is a single call whose result is the on_withdraw value; a rolled-back payout is an error, not a success', async () => {
    const ok = fakeRpc({ outcome: { status: { SuccessValue: b64({ withdrawn: '45' }) } } });
    await expect(adapter(ok).withdraw({ opId: 'w1', accountId: 'w.testnet', toAccountId: 'w.testnet', pool: POOL })).resolves.toMatchObject({ txHash: 'H1' });
    expect(ok.calls).toHaveLength(1);
    expect(ok.calls[0]).toMatchObject({ methodName: 'withdraw', args: { recipient_id: 'w.testnet', pool_id: POOL } });

    const rolledBack = fakeRpc({ outcome: { status: { SuccessValue: b64({ withdrawn: '0' }) } } });
    await expect(adapter(rolledBack).withdraw({ opId: 'w2', accountId: 'w.testnet', pool: POOL })).rejects.toMatchObject({ errorCode: 'NEAR_UNAVAILABLE', message: expect.stringContaining('withdraw_rolled_back') });
  });

  it('LST withdraw pays the matured shares through withdraw_lst and refuses an empty position', async () => {
    const rpc = fakeRpc({ views: { get_position: position(), get_account_positions: [position({ asset: 'meta-v2.pool.testnet' })] } });
    await adapter(rpc).withdraw({ opId: 'l1', accountId: 'w.testnet', pool: POOL, asset: 'stNEAR' });
    expect(rpc.calls[0]).toMatchObject({
      methodName: 'withdraw_lst',
      args: { pool_id: POOL, lst_contract: 'meta-v2.pool.testnet', amount: '40', account_id: 'w.testnet' },
    });
    const empty = fakeRpc({ views: { get_position: position({ withdrawable: '0' }), get_account_positions: [] } });
    await expect(adapter(empty).withdraw({ opId: 'l2', accountId: 'w.testnet', pool: POOL, asset: 'LiNEAR' })).rejects.toMatchObject({ errorCode: 'NOTHING_TO_WITHDRAW' });
    expect(empty.calls).toHaveLength(0);
  });

  it('reads the real wallet NEAR via view_account (exact yocto); unknown account is 0, an outage is a typed error', async () => {
    const yocto = '123456789012345678901234567';
    expect(await adapter(fakeRpc({ balance: async () => yocto })).nearBalanceOf('w.testnet')).toBe(yocto);
    expect(await adapter(fakeRpc({ balance: async () => { throw new Error('account w.testnet does not exist while viewing'); } })).nearBalanceOf('w.testnet')).toBe('0');
    await expect(adapter(fakeRpc({ balance: async () => { throw new Error('fetch failed: ECONNREFUSED'); } })).nearBalanceOf('w.testnet')).rejects.toMatchObject({ errorCode: 'NEAR_UNAVAILABLE', message: expect.stringContaining('rpc_unreachable') });
  });

  it('with W28 off the balance is the custodial vault (W20) and an outage still throws instead of returning 0', async () => {
    const rpc = fakeRpc({ views: { get_near_balance: '77' } });
    expect(await adapter(rpc, { TA_WAVES: '..27' }).nearBalanceOf('w.testnet')).toBe('77');
    expect(rpc.views[0]).toMatchObject({ contractId: STAKING, methodName: 'get_near_balance' });
    const down = fakeRpc({ views: { get_near_balance: () => { throw new Error('request timed out'); } } });
    await expect(adapter(down, { TA_WAVES: '..27' }).nearBalanceOf('w.testnet')).rejects.toMatchObject({ errorCode: 'NEAR_UNAVAILABLE', message: expect.stringContaining('rpc_timeout') });
  });

  it('reads LST balances with ft_balance_of on the right token contract and rejects a malformed answer', async () => {
    const rpc = fakeRpc({ views: { ft_balance_of: '1500' } });
    expect(await adapter(rpc).lstBalanceOf('w.testnet', 'LiNEAR')).toBe('1500');
    expect(rpc.views[0]).toMatchObject({ contractId: 'linear-protocol.testnet', methodName: 'ft_balance_of', args: { account_id: 'w.testnet' } });
    await expect(adapter(fakeRpc({ views: { ft_balance_of: { oops: 1 } } })).lstBalanceOf('w.testnet', 'stNEAR')).rejects.toMatchObject({ errorCode: "NEAR_UNAVAILABLE", message: expect.stringContaining("invalid_response") });
  });

  it('accountPositions maps the V2 view: clocks of 0 mean none, the LST contract names the asset', async () => {
    const rows = [
      position({ asset: 'NEAR', staked_since_ms: 1000, last_staked_at_ms: 2000 }),
      position({ pool_id: 'b.pool.testnet', asset: 'linear-protocol.testnet', staked_since_ms: 0, last_staked_at_ms: 0 }),
    ];
    const list = await adapter(fakeRpc({ views: { get_account_positions: rows } })).accountPositions!('w.testnet');
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ pool: POOL, asset: 'near', stakedSinceMs: 1000, lastStakedAtMs: 2000 });
    expect(list[1]).toMatchObject({ asset: 'LiNEAR', stakedSinceMs: null, lastStakedAtMs: null });
    await expect(adapter(fakeRpc({ views: { get_account_positions: 'nope' } })).accountPositions!('w.testnet')).rejects.toMatchObject({ errorCode: 'NEAR_UNAVAILABLE' });
  });

  it('position carries the deposit clocks of the V2 view with W28 on, and skips that view with it off', async () => {
    const on = fakeRpc({ views: { get_position: position(), get_account_positions: [position({ asset: 'NEAR', staked_since_ms: 5, last_staked_at_ms: 9 })] } });
    expect(await adapter(on).position({ accountId: 'w.testnet', pool: POOL })).toMatchObject({ stakedSinceMs: 5, lastStakedAtMs: 9, asset: 'near' });
    const off = fakeRpc({ views: { get_position: position() } });
    const v = await adapter(off, { TA_WAVES: '..27' }).position({ accountId: 'w.testnet', pool: POOL });
    expect(v.stakedSinceMs).toBeUndefined();
    expect(off.views.map((x) => x.methodName)).toEqual(['get_position']);
  });

  it('exposes the validator APY flagged as sim when the chain probe is down', async () => {
    const probe = { samples: async () => { throw new Error('fetch failed'); } };
    const a = new TestnetStakingAdapter(env(), fakeRpc(), probe);
    expect(await a.validatorApy()).toMatchObject({ source: 'sim', apyBp: 900, error: 'rpc_unreachable' });
  });

  it('mapAccountPosition and finalValueOf corner cases', () => {
    expect(mapAccountPosition(position({ asset: 'NEAR' }) as never, 'mainnet').asset).toBe('near');
    expect(mapAccountPosition(position({ asset: 'meta-pool.near' }) as never, 'mainnet').asset).toBe('stNEAR');
    expect(finalValueOf({ status: { SuccessValue: '' } })).toBeUndefined();
    expect(finalValueOf({ status: { Failure: {} } })).toBeUndefined();
    expect(finalValueOf(null)).toBeUndefined();
    expect(() => finalValueOf({ status: { SuccessValue: Buffer.from('not json').toString('base64') } })).toThrow(StakingRpcError);
  });
});
