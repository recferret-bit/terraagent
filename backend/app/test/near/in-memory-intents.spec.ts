import { describe, expect, it } from 'vitest';
import { InMemoryIntents } from '../../src/near/testing';

const W = 'nep245:res.terraagent.mock:bio.water';
const U = 'nep141:usdc.mock';
const future = Date.now() + 60_000;

describe('InMemoryIntents simulate/execute', () => {
  async function setup() {
    const f = new InMemoryIntents();
    f.fund('s.mock', 'bio.water', 10n);
    f.fund('b.mock', 'USDC', 100n);
    await f.deposit({ opId: 'd1', accountId: 's.mock', tokenId: W, amount: '10' });
    await f.deposit({ opId: 'd2', accountId: 'b.mock', tokenId: U, amount: '100' });
    const sign = (a: string, d: Record<string, string>) => f.signTokenDiff({ accountId: a, deltas: d, deadlineMs: future });
    return { f, sign };
  }

  it('moves all legs atomically; rejects non-zero sums, replays and shortfalls without change', async () => {
    const { f, sign } = await setup();
    const bad = [await sign('s.mock', { [W]: '-10', [U]: '100' }), await sign('b.mock', { [W]: '11', [U]: '-100' })];
    await expect(f.execute({ opId: 'x', intents: bad })).rejects.toMatchObject({ errorCode: 'NEAR_INTENT_DIFF_NOT_ZERO' });
    expect(f.verifierBalance('s.mock', W)).toBe(10n);
    const good = [await sign('s.mock', { [W]: '-10', [U]: '100' }), await sign('b.mock', { [W]: '10', [U]: '-100' })];
    const r = await f.execute({ opId: 'y', intents: good });
    expect(f.verifierBalance('b.mock', W)).toBe(10n);
    expect(f.verifierBalance('s.mock', U)).toBe(100n);
    expect(await f.execute({ opId: 'y', intents: good })).toEqual(r);
    await expect(f.execute({ opId: 'z', intents: good })).rejects.toMatchObject({ errorCode: 'NEAR_INTENT_NONCE_REUSED' });
    const poor = [await sign('s.mock', { [W]: '-1', [U]: '1' }), await sign('b.mock', { [W]: '1', [U]: '-1' })];
    expect(await f.simulate(poor)).toMatchObject({ ok: false, errorCode: 'NEAR_INSUFFICIENT_BALANCE' });
    await expect(f.execute({ opId: 'p', intents: poor })).rejects.toMatchObject({ errorCode: 'NEAR_INSUFFICIENT_BALANCE' });
    expect(f.verifierBalance('b.mock', W)).toBe(10n);
  });

  it('rejects expired and tampered intents', async () => {
    const { f, sign } = await setup();
    const a = await sign('s.mock', { [W]: '-1', [U]: '1' });
    const b = await sign('b.mock', { [W]: '1', [U]: '-1' });
    const late = new InMemoryIntents(undefined, () => future + 1);
    expect(await late.simulate([a, b])).toMatchObject({ ok: false, errorCode: 'NEAR_INTENT_BAD_SIGNATURE' });
    const tampered = { ...b, diff: { ...b.diff, deltas: { [W]: '1', [U]: '-2' } } };
    expect(await f.simulate([a, tampered])).toMatchObject({ ok: false, errorCode: 'NEAR_INTENT_BAD_SIGNATURE' });
  });
});
