import { describe, expect, it, vi } from 'vitest';
import { NearException } from '../../src/near/domain/errors.js';
import { IntentsRpcError, classifyIntentsRpcFailure } from '../../src/near/infrastructure/adapters/real/intents-rpc-error.js';
import {
  assertAllKeysOnchain,
  syncVerifierKeys,
  type VerifierKey,
  type VerifierRpc,
} from '../../src/near/infrastructure/adapters/real/verifier-key-sync.js';
import {
  executeOnVerifier,
  preflightVerifierSettlement,
  verifyStrictBalances,
} from '../../src/near/infrastructure/adapters/real/verifier-settlement.js';
import type { SignedIntent } from '../../src/near/application/ports/intents.port.js';

const VERIFIER = 'verifier.terraagent.testnet';
const PK = (n: number) => `ed25519:key${n}`;

function fakeRpc(opts: {
  registered?: Set<string>;
  balances?: Record<string, string>;
  viewError?: (method: string, args: Record<string, unknown>) => unknown;
  callError?: (method: string, args: Record<string, unknown>) => unknown;
  configured?: boolean;
} = {}) {
  const registered = opts.registered ?? new Set<string>();
  const calls: { methodName: string; args: Record<string, unknown>; signerAccountId: string }[] = [];
  const rpc = {
    config: {
      contracts: opts.configured === false ? {} : { verifier: VERIFIER },
      accounts: { minter: 'minter.terraagent.testnet' },
      secrets: { minterSecretKey: 'ed25519:secret' },
    },
    view: vi.fn(async (_c: string, method: string, args: Record<string, unknown> = {}) => {
      const err = opts.viewError?.(method, args);
      if (err) throw err;
      if (method === 'has_public_key') return registered.has(`${args.account_id}|${args.public_key}`);
      if (method === 'balance_of') return opts.balances?.[`${args.account_id}|${args.token_id}`] ?? '0';
      throw new Error(`unexpected view ${method}`);
    }),
    call: vi.fn(async (p: { methodName: string; args: Record<string, unknown>; signerAccountId: string }) => {
      const err = opts.callError?.(p.methodName, p.args);
      if (err) throw err;
      calls.push(p);
      if (p.methodName === 'register_account_key') registered.add(`${p.args.account_id}|${p.args.public_key}`);
      return { receipt: { txHash: 'h', network: 'testnet' } };
    }),
  } as unknown as VerifierRpc & { view: ReturnType<typeof vi.fn>; call: ReturnType<typeof vi.fn> };
  return { rpc, calls, registered };
}

const key = (n: number, role: VerifierKey['role'] = 'pilot', accountId = `acc${n}.testnet`): VerifierKey => ({ accountId, publicKey: PK(n), role });
const intent = (accountId: string, deltas: Record<string, string>, publicKey: string | null = PK(1)): SignedIntent => ({
  diff: { accountId, deltas },
  signature: 'ed25519:sig',
  nonce: 'n',
  deadlineMs: Date.now() + 60_000,
  ...(publicKey ? { publicKey } : {}),
});

describe('classifyIntentsRpcFailure', () => {
  const d = { operation: 'op' };
  it('maps network, timeout, JSON-RPC body and insufficient-funds failures to typed codes', () => {
    expect(classifyIntentsRpcFailure(new TypeError('fetch failed'), d).code).toBe('rpc_unreachable');
    expect(classifyIntentsRpcFailure(new Error('connect ECONNREFUSED 127.0.0.1:1'), d).code).toBe('rpc_unreachable');
    expect(classifyIntentsRpcFailure(new Error('The operation was aborted due to timeout'), d).code).toBe('rpc_timeout');
    expect(classifyIntentsRpcFailure(new Error('Timeout of 30000ms exceeded'), d).code).toBe('rpc_timeout');
    const body = Object.assign(new Error('RPC error'), { cause: { name: 'HANDLER_ERROR', info: { error_message: 'wasm execution failed' } } });
    expect(classifyIntentsRpcFailure(body, d).code).toBe('rpc_error');
    expect(classifyIntentsRpcFailure(new Error('Smart contract panicked: NEAR_INSUFFICIENT_FUNDS: verifier balance insufficient'), d).code).toBe(
      'insufficient_onchain_balance',
    );
    expect(classifyIntentsRpcFailure(new NearException('NEAR_INSUFFICIENT_BALANCE'), d).code).toBe('insufficient_onchain_balance');
  });
  it('keeps the cause, passes typed errors through and maps to API exceptions', () => {
    const cause = new Error('boom');
    const e = classifyIntentsRpcFailure(cause, { operation: 'x', accountId: 'a' });
    expect(e.cause).toBe(cause);
    expect(e.details.accountId).toBe('a');
    expect(classifyIntentsRpcFailure(e, d)).toBe(e);
    expect(new IntentsRpcError('insufficient_onchain_balance', 'm', d).toNearException().errorCode).toBe('NEAR_INSUFFICIENT_BALANCE');
    expect(new IntentsRpcError('key_not_registered', 'm', d).toNearException().errorCode).toBe('NEAR_INTENT_BAD_SIGNATURE');
    expect(e.toNearException().errorCode).toBe('NEAR_UNAVAILABLE');
  });
});

describe('syncVerifierKeys', () => {
  it('registers pilot, session and bot keys via register_account_key as the operator; all_keys_onchain is true', async () => {
    const { rpc, calls, registered } = fakeRpc();
    const keys = [key(1, 'pilot'), key(2, 'session'), key(3, 'bot', 'bot-1.testnet')];
    const report = await syncVerifierKeys(rpc, keys);
    expect(report.allKeysOnchain).toBe(true);
    expect(report.registered).toHaveLength(3);
    expect(report.skipped).toHaveLength(0);
    expect(calls.map((c) => c.methodName)).toEqual(Array(3).fill('register_account_key'));
    expect(calls[0]).toMatchObject({ signerAccountId: 'minter.terraagent.testnet', args: { account_id: 'acc1.testnet', public_key: PK(1) } });
    expect(registered.size).toBe(3);
  });

  it('is idempotent: keys already registered are skipped, and a second run sends nothing', async () => {
    const { rpc, calls } = fakeRpc({ registered: new Set([`acc1.testnet|${PK(1)}`]) });
    const first = await syncVerifierKeys(rpc, [key(1), key(2)]);
    expect(first.skipped.map((k) => k.publicKey)).toEqual([PK(1)]);
    expect(first.registered.map((k) => k.publicKey)).toEqual([PK(2)]);
    const second = await syncVerifierKeys(rpc, [key(1), key(2)]);
    expect(second.registered).toHaveLength(0);
    expect(second.skipped).toHaveLength(2);
    expect(calls).toHaveLength(1);
  });

  it('dedupes identical (account, key) pairs and handles an empty list', async () => {
    const { rpc, calls } = fakeRpc();
    expect((await syncVerifierKeys(rpc, [key(1), key(1)])).registered).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(await syncVerifierKeys(rpc, [])).toMatchObject({ allKeysOnchain: true, registered: [], skipped: [], failed: [] });
  });

  it('reports a partial failure with a typed error and still registers the other keys', async () => {
    const { rpc, registered } = fakeRpc({
      callError: (_m, args) => (args.public_key === PK(2) ? new Error('Timeout of 30000ms exceeded') : undefined),
    });
    const report = await syncVerifierKeys(rpc, [key(1), key(2), key(3)]);
    expect(report.allKeysOnchain).toBe(false);
    expect(report.registered.map((k) => k.publicKey)).toEqual([PK(1), PK(3)]);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]!.error).toBeInstanceOf(IntentsRpcError);
    expect(report.failed[0]!.error.code).toBe('rpc_timeout');
    expect(registered.has(`acc2.testnet|${PK(2)}`)).toBe(false);
    expect(() => assertAllKeysOnchain(report)).toThrowError(expect.objectContaining({ code: 'key_not_registered' }));
  });

  it('surfaces a failing has_public_key view as a failed key, never as "not registered, register it"', async () => {
    const { rpc, calls } = fakeRpc({ viewError: () => new TypeError('fetch failed') });
    const report = await syncVerifierKeys(rpc, [key(1)]);
    expect(report.failed[0]!.error.code).toBe('rpc_unreachable');
    expect(calls).toHaveLength(0);
  });

  it('throws verifier_not_configured when NEAR_CONTRACT_VERIFIER is unset', async () => {
    const { rpc } = fakeRpc({ configured: false });
    await expect(syncVerifierKeys(rpc, [key(1)])).rejects.toMatchObject({ code: 'verifier_not_configured' });
  });
});

describe('verifyStrictBalances / preflight / execute', () => {
  const USDC = 'nep141:usdc.mock';
  const WATER = 'nep245:res.terraagent.mock:bio.water';

  it('passes when on-chain balances cover every outflow of the batch (corner: exactly equal)', async () => {
    const { rpc } = fakeRpc({ balances: { [`seller.testnet|${WATER}`]: '100' } });
    await expect(
      verifyStrictBalances(rpc, [intent('seller.testnet', { [WATER]: '-100', [USDC]: '500' }), intent('buyer.testnet', { [WATER]: '100', [USDC]: '-0' })]),
    ).resolves.toBeUndefined();
    expect(rpc.view).toHaveBeenCalledTimes(1);
  });

  it('rejects with insufficient_onchain_balance carrying required/available', async () => {
    const { rpc } = fakeRpc({ balances: { [`seller.testnet|${WATER}`]: '99' } });
    await expect(verifyStrictBalances(rpc, [intent('seller.testnet', { [WATER]: '-100' })])).rejects.toMatchObject({
      code: 'insufficient_onchain_balance',
      details: { accountId: 'seller.testnet', tokenId: WATER, required: '100', available: '99' },
    });
  });

  it('sums deltas of the same account/token across intents of the batch', async () => {
    const { rpc } = fakeRpc({ balances: { [`a.testnet|${USDC}`]: '150' } });
    await expect(
      verifyStrictBalances(rpc, [intent('a.testnet', { [USDC]: '-100' }), intent('a.testnet', { [USDC]: '-100' })]),
    ).rejects.toMatchObject({ code: 'insufficient_onchain_balance' });
  });

  it('classifies balance_of RPC failures instead of treating them as zero or enough', async () => {
    const net = fakeRpc({ viewError: () => new TypeError('fetch failed') });
    await expect(verifyStrictBalances(net.rpc, [intent('a.testnet', { [USDC]: '-1' })])).rejects.toMatchObject({ code: 'rpc_unreachable' });
    const rpcBody = fakeRpc({ viewError: () => Object.assign(new Error('RPC error'), { cause: { name: 'UNKNOWN_BLOCK' } }) });
    await expect(verifyStrictBalances(rpcBody.rpc, [intent('a.testnet', { [USDC]: '-1' })])).rejects.toMatchObject({ code: 'rpc_error' });
  });

  it('preflight registers keys first, then checks balances; an unregistered key stops before any balance read', async () => {
    const ok = fakeRpc({ balances: { [`a.testnet|${USDC}`]: '10' } });
    const roles: string[] = [];
    const report = await preflightVerifierSettlement(ok.rpc, [intent('a.testnet', { [USDC]: '-10' })], (a) => {
      roles.push(a);
      return 'pilot';
    });
    expect(report.allKeysOnchain).toBe(true);
    expect(roles).toEqual(['a.testnet']);

    const bad = fakeRpc({ callError: () => new TypeError('fetch failed') });
    await expect(preflightVerifierSettlement(bad.rpc, [intent('a.testnet', { [USDC]: '-10' })], () => 'bot')).rejects.toMatchObject({
      code: 'key_not_registered',
    });
    expect(bad.rpc.view).not.toHaveBeenCalledWith(VERIFIER, 'balance_of', expect.anything());
  });

  it('preflight rejects an intent without a signer public key', async () => {
    const { rpc } = fakeRpc();
    await expect(preflightVerifierSettlement(rpc, [intent('a.testnet', { [USDC]: '1' }, null)], () => 'pilot')).rejects.toMatchObject({
      code: 'key_not_registered',
    });
  });

  it('executeOnVerifier returns the receipt and surfaces failures as typed errors (no silent mock fallback)', async () => {
    const ok = fakeRpc();
    const r = await executeOnVerifier(ok.rpc, { opId: 'op1', intents: [] });
    expect(r.txHash).toBe('h');
    expect(ok.calls[0]).toMatchObject({ methodName: 'execute_intents', args: { op_id: 'op1' } });
    const fail = fakeRpc({ callError: () => new Error('Smart contract panicked: NEAR_INSUFFICIENT_FUNDS: verifier balance insufficient') });
    await expect(executeOnVerifier(fail.rpc, { opId: 'op2', intents: [] })).rejects.toMatchObject({ code: 'insufficient_onchain_balance' });
    const down = fakeRpc({ callError: () => new Error('Timeout of 30000ms exceeded') });
    await expect(executeOnVerifier(down.rpc, { opId: 'op3', intents: [] })).rejects.toMatchObject({ code: 'rpc_timeout' });
  });
});
