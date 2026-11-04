import { MARKET_TOKENS, toChainUnits } from '@terra/contracts';
import { expect } from 'vitest';
import { IntentsPort, type SignedIntent } from '../application/ports/intents.port';
import { defineNearContract, type AdapterUnderTest } from './harness';

const WATER = MARKET_TOKENS['bio.water'].verifierId;
const USDC = MARKET_TOKENS.USDC.verifierId;
const w = (n: number): bigint => toChainUnits('bio.water', String(n));
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * Helpers an adapter under test gets. Mocks and fakes expose `testRegisterSigner` / `testSeedVerifier` / `testSeedOwn`.
 * A real adapter has none: `signer()` then returns the funded account named by `CONTRACT_INTENTS_SIGNER` (W23-23), and only the
 * `simulate` cases run (the write cases are `mockOnly`).
 */
export interface IntentsHelpers {
  /** A fresh account with a registered signing key (mock), or the configured real signer. */
  signer(prefix: string): Promise<string>;
  seedVerifier(accountId: string, verifierId: string, chainAmount: bigint): Promise<void>;
  seedOwn(accountId: string, tokenKey: string, chainAmount: bigint): Promise<void>;
}

interface TestHooks {
  testRegisterSigner(accountId: string): Promise<void>;
  testSeedVerifier(accountId: string, verifierId: string, chainAmount: bigint): Promise<void>;
  testSeedOwn(accountId: string, tokenKey: string, chainAmount: bigint): Promise<void>;
}

async function helpers(port: IntentsPort, kind: string, env: Readonly<Record<string, string | undefined>>): Promise<IntentsHelpers> {
  const hooks = port as Partial<TestHooks>;
  if (hooks.testRegisterSigner && hooks.testSeedVerifier && hooks.testSeedOwn) {
    const h = hooks as TestHooks;
    return {
      signer: async (prefix) => {
        const id = `${prefix}-${uid()}.terraagent.mock`;
        await h.testRegisterSigner(id);
        return id;
      },
      seedVerifier: (a, t, n) => h.testSeedVerifier(a, t, n),
      seedOwn: (a, t, n) => h.testSeedOwn(a, t, n),
    };
  }
  const configured = env.CONTRACT_INTENTS_SIGNER;
  if (!configured) throw new Error(`Intents contract on ${kind}: set CONTRACT_INTENTS_SIGNER to a signer account whose key the adapter can sign with`);
  const unsupported = async () => { throw new Error(`${kind} adapter cannot seed balances; write cases are mockOnly`); };
  return { signer: async () => configured, seedVerifier: unsupported, seedOwn: unsupported };
}

type A = AdapterUnderTest<IntentsPort, IntentsHelpers>;
const later = () => Date.now() + 3_600_000;

/** A two-party trade: `seller` gives `water` whole units for `usdc`; `skew` makes the water legs not sum to zero. */
async function trade(a: A, seller: string, buyer: string, water: number, usdc: bigint, opts: { skew?: bigint; deadlineMs?: number } = {}): Promise<SignedIntent[]> {
  const deadlineMs = opts.deadlineMs ?? later();
  return [
    await a.port.signTokenDiff({ accountId: seller, deltas: { [WATER]: (-w(water)).toString(), [USDC]: usdc.toString() }, deadlineMs }),
    await a.port.signTokenDiff({ accountId: buyer, deltas: { [WATER]: (w(water) + (opts.skew ?? 0n)).toString(), [USDC]: (-usdc).toString() }, deadlineMs }),
  ];
}

async function funded(a: A, water: number, usdc: bigint): Promise<{ seller: string; buyer: string }> {
  const seller = await a.signer('seller');
  const buyer = await a.signer('buyer');
  await a.seedVerifier(seller, WATER, w(water));
  await a.seedVerifier(buyer, USDC, usdc);
  return { seller, buyer };
}

/** Port contract for `IntentsPort` (the `intents.near` verifier). Same suite for the mock, the fake and (simulate only) the real adapter. */
export const contract = defineNearContract<IntentsPort, IntentsHelpers>({
  port: 'Intents',
  helpers,
  suite: ({ test, mockOnly, expectReceipt }) => {
    test('signTokenDiff returns a signed intent that simulate accepts when it sums to zero', async (a) => {
      const s = await a.signer('s');
      const b = await a.signer('b');
      const [i1, i2] = await trade(a, s, b, 1, 1n);
      expect(i1!.signature).toMatch(/^ed25519:/);
      expect(Buffer.from(i1!.nonce, 'base64')).toHaveLength(32);
      const sim = await a.port.simulate([i1!, i2!]);
      expect(sim.effects).toHaveLength(2);
      // a fresh signer holds nothing, so the batch is well-formed but unfunded on a mock; the real signer may be funded
      expect(['NEAR_INSUFFICIENT_BALANCE', undefined]).toContain(sim.errorCode);
    });

    test('simulate rejects legs that do not sum to zero per token', async (a) => {
      const s = await a.signer('s');
      const b = await a.signer('b');
      const sim = await a.port.simulate(await trade(a, s, b, 1, 1n, { skew: 1n }));
      expect(sim).toMatchObject({ ok: false, errorCode: 'NEAR_INTENT_DIFF_NOT_ZERO' });
    });

    test('simulate rejects an expired deadline', async (a) => {
      const s = await a.signer('s');
      const b = await a.signer('b');
      const sim = await a.port.simulate(await trade(a, s, b, 1, 1n, { deadlineMs: Date.now() - 60_000 }));
      expect(sim).toMatchObject({ ok: false, errorCode: 'NEAR_INTENT_EXPIRED' });
    });

    test('simulate rejects a tampered amount (bad signature)', async (a) => {
      const s = await a.signer('s');
      const b = await a.signer('b');
      const [i1, i2] = await trade(a, s, b, 1, 1n);
      const tampered = { ...i2!, diff: { ...i2!.diff, deltas: { ...i2!.diff.deltas, [USDC]: '-2' } } };
      expect(await a.port.simulate([i1!, tampered])).toMatchObject({ ok: false, errorCode: 'NEAR_INTENT_BAD_SIGNATURE' });
    });

    mockOnly('execute moves every leg of a valid batch; the same opId replays the same receipt', async (a) => {
      const { seller, buyer } = await funded(a, 10, 100n);
      const batch = await trade(a, seller, buyer, 10, 100n);
      expect(await a.port.simulate(batch)).toMatchObject({ ok: true });
      const opId = `exec:${uid()}`;
      const r = await a.port.execute({ opId, intents: batch });
      expectReceipt(r, a, 'success');
      expect(await a.port.execute({ opId, intents: batch })).toMatchObject({ txHash: r.txHash });
      // balances moved exactly once: a second trade of the same size no longer has water to give
      const again = await trade(a, seller, buyer, 10, 100n);
      expect(await a.port.simulate(again)).toMatchObject({ ok: false, errorCode: 'NEAR_INSUFFICIENT_BALANCE' });
    });

    mockOnly('execute rejects a batch whose water legs sum to +1 and changes nothing', async (a) => {
      const { seller, buyer } = await funded(a, 10, 100n);
      await expect(a.port.execute({ opId: `bad:${uid()}`, intents: await trade(a, seller, buyer, 10, 100n, { skew: 1n }) })).rejects.toMatchObject({ errorCode: 'NEAR_INTENT_DIFF_NOT_ZERO' });
      expect(await a.port.simulate(await trade(a, seller, buyer, 10, 100n))).toMatchObject({ ok: true });
    });

    mockOnly('an insufficient balance fails the whole batch', async (a) => {
      const { seller, buyer } = await funded(a, 5, 100n);
      const batch = await trade(a, seller, buyer, 10, 100n);
      expect(await a.port.simulate(batch)).toMatchObject({ ok: false, errorCode: 'NEAR_INSUFFICIENT_BALANCE' });
      await expect(a.port.execute({ opId: `poor:${uid()}`, intents: batch })).rejects.toMatchObject({ errorCode: 'NEAR_INSUFFICIENT_BALANCE' });
      const ok = await trade(a, seller, buyer, 5, 100n);
      expect(await a.port.simulate(ok)).toMatchObject({ ok: true });
    });

    mockOnly('a replayed nonce is rejected under a new opId', async (a) => {
      const { seller, buyer } = await funded(a, 20, 200n);
      const batch = await trade(a, seller, buyer, 10, 100n);
      await a.port.execute({ opId: `n1:${uid()}`, intents: batch });
      expect(await a.port.simulate(batch)).toMatchObject({ ok: false, errorCode: 'NEAR_INTENT_NONCE_REUSED' });
      await expect(a.port.execute({ opId: `n2:${uid()}`, intents: batch })).rejects.toMatchObject({ errorCode: 'NEAR_INTENT_NONCE_REUSED' });
    });

    mockOnly('deposit then withdraw round-trips own and verifier balances (chain base units)', async (a) => {
      const acct = await a.signer('dep');
      await a.seedOwn(acct, 'bio.water', w(300));
      const d = await a.port.deposit({ opId: `dep:${uid()}`, accountId: acct, tokenId: WATER, amount: w(300).toString() });
      expectReceipt(d, a, 'success');
      await expect(a.port.deposit({ opId: `dep2:${uid()}`, accountId: acct, tokenId: WATER, amount: '1' })).rejects.toMatchObject({ errorCode: 'NEAR_INSUFFICIENT_BALANCE' });
      const wd = await a.port.withdraw({ opId: `wd:${uid()}`, accountId: acct, tokenId: WATER, amount: w(100).toString(), to: acct });
      expectReceipt(wd, a, 'success');
      await expect(a.port.withdraw({ opId: `wd2:${uid()}`, accountId: acct, tokenId: WATER, amount: w(201).toString(), to: acct })).rejects.toMatchObject({ errorCode: 'NEAR_INSUFFICIENT_BALANCE' });
      // 200 left in the verifier: it can fund a 200-water leg, not a 201 one
      const peer = await a.signer('peer');
      expect(await a.port.simulate(await trade(a, acct, peer, 200, 0n))).toMatchObject({ ok: true });
      expect(await a.port.simulate(await trade(a, acct, peer, 201, 0n))).toMatchObject({ ok: false, errorCode: 'NEAR_INSUFFICIENT_BALANCE' });
    });
  },
});
