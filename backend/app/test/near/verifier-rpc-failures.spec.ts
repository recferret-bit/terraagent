import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveNearNetworkConfig } from '../../src/near/infrastructure/network/near-network.config.js';
import { NearRpcClient } from '../../src/near/infrastructure/rpc/near-rpc.client.js';
import { syncVerifierKeys } from '../../src/near/infrastructure/adapters/real/verifier-key-sync.js';
import { verifyStrictBalances } from '../../src/near/infrastructure/adapters/real/verifier-settlement.js';

/** Real `NearRpcClient` + real near-api-js provider over an injected `fetch` (no network, no signing). */
const env = {
  NODE_ENV: 'test',
  NEAR_MODE: 'testnet',
  NEAR_CONTRACT_VERIFIER: 'verifier.terraagent.testnet',
  NEAR_MINTER_SECRET_KEY: 'ed25519:3D4YudUQRE39Lc4JHghuB5WM8kbgDDa2s5QnMzgNhGeqCMdoSzQk1ceDUZCXjFPNs6XNMeqzfXWuEdgV4tkv1CDG',
} as Record<string, string>;
const rpc = () => new NearRpcClient(resolveNearNetworkConfig(env, 'testnet'));
const keys = [{ accountId: 'pilot.testnet', publicKey: 'ed25519:abc', role: 'pilot' as const }];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('verifier RPC failures surface as typed errors (injected fetch)', () => {
  it('network error -> rpc_unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const report = await syncVerifierKeys(rpc(), keys);
    expect(report.allKeysOnchain).toBe(false);
    expect(report.failed[0]!.error.code).toBe('rpc_unreachable');
  }, 60_000);

  it('JSON-RPC error body -> rpc_error (not swallowed as an empty/false result)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      jsonrpc: '2.0', id: 'dontcare',
      error: { name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_BLOCK', info: {} }, code: -32000, message: 'Server error', data: 'The node does not track the shard' },
    })));
    await expect(
      verifyStrictBalances(rpc(), [{ diff: { accountId: 'a.testnet', deltas: { 'nep141:usdc.mock': '-1' } }, signature: 's', nonce: 'n', deadlineMs: 1, publicKey: 'ed25519:abc' }]),
    ).rejects.toMatchObject({ code: 'rpc_error' });
  }, 60_000);

  it('timeout -> rpc_timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); }));
    const report = await syncVerifierKeys(rpc(), keys);
    expect(report.failed[0]!.error.code).toBe('rpc_timeout');
  }, 60_000);
});
