import { describe, expect, it } from 'vitest';
import { NearException } from '../../src/near/domain/errors';
import { runRelayed, SignerLane } from '../../src/near/infrastructure/adapters/relayer/nonce-lane';

const byNonce = (a: bigint, b: bigint): number => (a < b ? -1 : a > b ? 1 : 0);

describe('relayer nonce lane', () => {
  it('gives 20 parallel actions for one signer the nonces 1n..20n, one each', async () => {
    const lane = new SignerLane();
    let inFlight = 0;
    let maxInFlight = 0;
    const results = await Promise.all(Array.from({ length: 20 }, () => runRelayed(lane, 'alice.near', async (nonce) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { nonce };
    })));
    const nonces = results.map((result) => result.nonce).sort(byNonce);
    expect(nonces).toEqual(Array.from({ length: 20 }, (_, i) => BigInt(i + 1)));
    expect(maxInFlight).toBe(1);
  });

  it('does not share a sequence across signers, and one signer does not block another', async () => {
    const lane = new SignerLane();
    let releaseAlice!: () => void;
    const hold = new Promise<void>((resolve) => { releaseAlice = resolve; });
    const alice = runRelayed(lane, 'alice.near', async (nonce) => {
      await hold;
      return nonce;
    });
    const bob = Promise.all([
      runRelayed(lane, 'bob.near', async (nonce) => nonce),
      runRelayed(lane, 'bob.near', async (nonce) => nonce),
    ]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const blocked = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('bob blocked on alice')), 200);
    });
    try {
      await expect(Promise.race([bob, blocked])).resolves.toEqual([1n, 2n]);
    } finally {
      clearTimeout(timer);
    }
    releaseAlice();
    await expect(alice).resolves.toBe(1n);
  });

  it('calls a mock injected failure twice, then rejects NEAR_RELAY_FAILED', async () => {
    const lane = new SignerLane();
    const seen: bigint[] = [];
    let thrown: unknown;
    try {
      await runRelayed(lane, 'alice.near', async (nonce) => {
        seen.push(nonce);
        throw new NearException('NEAR_MOCK_INJECTED_FAILURE');
      });
    } catch (error) {
      thrown = error;
    }
    expect(seen).toEqual([1n, 2n]);
    expect(thrown).toBeInstanceOf(NearException);
    expect(thrown).toMatchObject({ errorCode: 'NEAR_RELAY_FAILED' });
    await expect(runRelayed(lane, 'alice.near', async (nonce) => nonce)).resolves.toBe(3n);
  });

  it('retries InvalidNonce once and the second call gets a strictly greater nonce', async () => {
    const lane = new SignerLane();
    const seen: bigint[] = [];
    const result = await runRelayed(lane, 'alice.near', async (nonce) => {
      seen.push(nonce);
      if (seen.length === 1) throw Object.assign(new Error('InvalidNonce'), {});
      return { nonce };
    });
    expect(seen).toHaveLength(2);
    expect(seen[1]! > seen[0]!).toBe(true);
    expect(result).toEqual({ nonce: seen[1] });
    await expect(runRelayed(lane, 'alice.near', async (nonce) => nonce)).resolves.toBe(seen[1]! + 1n);
  });

  it('does not retry or wrap NEAR_RELAY_RECEIVER_NOT_ALLOWED', async () => {
    const lane = new SignerLane();
    const error = new NearException('NEAR_RELAY_RECEIVER_NOT_ALLOWED');
    let calls = 0;
    let thrown: unknown;
    try {
      await runRelayed(lane, 'alice.near', async () => {
        calls += 1;
        throw error;
      });
    } catch (caught) {
      thrown = caught;
    }
    expect(calls).toBe(1);
    expect(thrown).toBe(error);
  });
});
