import { describe, expect, it } from 'vitest';
import { isDeterministicChainError } from '../../src/near/infrastructure/rpc/near-error-map.js';
import { NearRpcClient } from '../../src/near/infrastructure/rpc/near-rpc.client.js';
import { resolveNearNetworkConfig } from '../../src/near/infrastructure/network/near-network.config.js';
import { isMethodNotFoundRpcError } from '../../src/near/staking/lst-pools.js';

/** As near-api-js 7.5 throws it (`RpcError`) for a view whose argument the contract rejects (seen on testnet). */
const GUEST_PANIC =
  'wasm execution failed with error: HostError(GuestPanic { panic_msg: "Failed to deserialize input from JSON. Error: `invalid value: \\"pl_dev--col_7.terraagent.testnet\\", the Account ID has a redundant separator \'-\' at index 7`" })';
/** As near-api-js 7.5 throws it for a view of a method the deployed contract does not have (seen on testnet). */
function methodNotFound(): Error {
  const err = new Error('Contract method is not found at block height 279015818');
  err.name = 'ContractMethodNotFoundError';
  return err;
}
const DEAD_FALLBACK = '{"jsonrpc": "2.0", "error": {"code": -429, "message": "WARNING! THIS ENDPOINT IS DEPRECATED!"}, "id": "1"} 429';

interface FakeProvider { query: (req: unknown) => Promise<unknown>; calls: number }
const provider = (answer: () => Promise<unknown>): FakeProvider => {
  const p: FakeProvider = { calls: 0, query: () => { p.calls += 1; return answer(); } };
  return p;
};

/** A real client with its two providers swapped for fakes (the retry loop under test is the client's own). */
function clientWith(primary: FakeProvider, fallback: FakeProvider): NearRpcClient {
  const client = new NearRpcClient(resolveNearNetworkConfig({ NEAR_MODE: 'testnet', NEAR_ROOT_ACCOUNT: 'terraagent.testnet' }));
  Object.assign(client as unknown as Record<string, unknown>, { primary, fallback });
  return client;
}

describe('NEAR view errors raised inside the contract are deterministic', () => {
  it('classifies a guest panic and a missing method as deterministic, and a dead endpoint as not', () => {
    expect(isDeterministicChainError(new Error(`Querying failed: ${GUEST_PANIC}`))).toBe(true);
    expect(isDeterministicChainError(methodNotFound())).toBe(true);
    expect(isDeterministicChainError(new Error('wasm execution failed with error: MethodResolveError(MethodNotFound)'))).toBe(true);
    expect(isMethodNotFoundRpcError(methodNotFound())).toBe(true); // the staking sync's own check recognises it
    expect(isDeterministicChainError(new Error(DEAD_FALLBACK))).toBe(false);
  });

  it('view() fails at once with the contract error instead of retrying through the fallback endpoint', async () => {
    const primary = provider(() => Promise.reject(new Error(`Querying failed: ${GUEST_PANIC}`)));
    const fallback = provider(() => Promise.reject(new Error(DEAD_FALLBACK)));
    const started = Date.now();
    await expect(clientWith(primary, fallback).view('res.terraagent.testnet', 'mt_balance_of', { account_id: 'pl_dev--col_7.terraagent.testnet', token_id: 'bio.water' }))
      .rejects.toThrow(/redundant separator/);
    expect(primary.calls).toBe(1);
    expect(fallback.calls).toBe(0);
    expect(Date.now() - started).toBeLessThan(150);
  });

  it('a missing contract method keeps its text, so callers can recognise it', async () => {
    const primary = provider(() => Promise.reject(methodNotFound()));
    const fallback = provider(() => Promise.reject(new Error(DEAD_FALLBACK)));
    await expect(clientWith(primary, fallback).view('staking.terraagent.testnet', 'get_account_positions', {})).rejects.toThrow(/method is not found/);
    expect(primary.calls).toBe(1);
    expect(fallback.calls).toBe(0);
  });

  it('a transport failure on the primary still fails over to the fallback', async () => {
    const primary = provider(() => Promise.reject(new Error('fetch failed: ECONNRESET')));
    const fallback = provider(() => Promise.resolve({ result: [...Buffer.from('"42"')], block_height: 1 }));
    await expect(clientWith(primary, fallback).view<string>('res.terraagent.testnet', 'mt_balance_of', {})).resolves.toBe('42');
    expect(fallback.calls).toBe(1);
  });
});
