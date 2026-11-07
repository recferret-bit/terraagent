import { afterEach, describe, expect, it } from 'vitest';
import { FaultPlan } from '../../src/near/infrastructure/mock/fault-plan';
import { mockChainControls } from '../../src/near/infrastructure/mock/mock-controls';
import { InMemoryIntents } from '../../src/near/testing/in-memory-intents';
import { MARKET_TOKENS } from '@terra/contracts';

const call = (method = 'execute', opId?: string) => ({ port: 'Intents', method, ...(opId ? { opId } : {}) });
afterEach(() => mockChainControls.reset());

describe('FaultPlan', () => {
  it('fires exactly `times` times, in order, then disarms', () => {
    const plan = new FaultPlan();
    const h = plan.inject({ kind: 'fail_before', port: 'intents', method: 'execute', times: 2 });
    expect(() => plan.beforeSync(call())).toThrow(/failed before submit/);
    expect(() => plan.beforeSync(call())).toThrow(/failed before submit/);
    expect(plan.beforeSync(call())).toBeNull();
    expect(h.fired()).toBe(2);
  });

  it('skip delays the first firing; method, port and opId prefix narrow the match', () => {
    const plan = new FaultPlan();
    plan.inject({ kind: 'insufficient_funds', method: 'execute', opIdPrefix: 'trade:', skip: 1 });
    expect(plan.beforeSync(call('deposit', 'trade:1'))).toBeNull(); // other method
    expect(plan.beforeSync({ port: 'Intents', method: 'execute', opId: 'market-deposit:x' })).toBeNull(); // other prefix
    expect(plan.beforeSync(call('execute', 'trade:1'))).toBeNull(); // skipped
    expect(() => plan.beforeSync(call('execute', 'trade:2'))).toThrow(/insufficient funds/);
    expect(plan.beforeSync(call('execute', 'trade:3'))).toBeNull();
  });

  it('a rule for another port never fires', () => {
    const plan = new FaultPlan();
    const h = plan.inject({ kind: 'fail_before', port: 'CargoToken' });
    expect(plan.beforeSync(call())).toBeNull();
    expect(h.fired()).toBe(0);
  });

  it('rejects bad parameters', () => {
    const plan = new FaultPlan();
    expect(() => plan.inject({ kind: 'nope' as never })).toThrow(/unknown fault kind/);
    expect(() => plan.inject({ kind: 'fail_before', times: 0 })).toThrow(/times/);
    expect(() => plan.inject({ kind: 'fail_before', skip: -1 })).toThrow(/skip/);
  });

  it('fail_after and duplicate are reported as pending post-effects', () => {
    const plan = new FaultPlan();
    plan.inject({ kind: 'fail_after' });
    plan.inject({ kind: 'duplicate' });
    const a = plan.beforeSync(call());
    expect(a).toBe('fail_after');
    expect(() => FaultPlan.after(a, call())).toThrow(/outcome unknown/);
    const b = plan.beforeSync(call());
    expect(b).toBe('duplicate');
    expect(() => FaultPlan.after(b, call())).not.toThrow();
  });

  it('hold blocks until released and waitHeld resolves once the call is blocked', async () => {
    const plan = new FaultPlan();
    const h = plan.inject({ kind: 'hold', method: 'execute' });
    let done = false;
    const p = plan.before(call('execute', 'trade:1')).then(() => { done = true; });
    await h.waitHeld();
    await Promise.resolve();
    expect(done).toBe(false);
    h.release();
    await p;
    expect(done).toBe(true);
    expect(await plan.before(call())).toBeNull(); // released rule no longer holds
  });

  it('reset releases held calls and clears rules', async () => {
    const plan = new FaultPlan();
    plan.inject({ kind: 'hold' });
    const p = plan.before(call());
    plan.reset();
    await p;
    expect(plan.beforeSync(call())).toBeNull();
  });
});

describe('faults through the in-memory intents fake', () => {
  const WATER = MARKET_TOKENS['bio.water'].verifierId;
  const setup = async () => {
    const intents = new InMemoryIntents();
    await intents.testSeedVerifier('a.mock', WATER, 1000n);
    return intents;
  };

  it('fail_before leaves the ledger untouched and the same opId can be retried', async () => {
    const intents = await setup();
    mockChainControls.faults.inject({ kind: 'fail_before', method: 'withdraw' });
    const input = { opId: 'w1', accountId: 'a.mock', tokenId: WATER, amount: '100', to: 'a.mock' };
    await expect(intents.withdraw(input)).rejects.toMatchObject({ errorCode: 'NEAR_MOCK_INJECTED_FAILURE' });
    expect(intents.verifierBalance('a.mock', WATER)).toBe(1000n);
    await intents.withdraw(input);
    expect(intents.verifierBalance('a.mock', WATER)).toBe(900n);
  });

  it('fail_after applies the write, throws NEAR_UNAVAILABLE, and the retry replays without a second effect', async () => {
    const intents = await setup();
    mockChainControls.faults.inject({ kind: 'fail_after', method: 'withdraw' });
    const input = { opId: 'w2', accountId: 'a.mock', tokenId: WATER, amount: '100', to: 'a.mock' };
    await expect(intents.withdraw(input)).rejects.toMatchObject({ errorCode: 'NEAR_UNAVAILABLE' });
    expect(intents.verifierBalance('a.mock', WATER)).toBe(900n);
    await intents.withdraw(input);
    expect(intents.verifierBalance('a.mock', WATER)).toBe(900n);
  });

  it('duplicate delivery never moves funds twice', async () => {
    const intents = await setup();
    mockChainControls.faults.inject({ kind: 'duplicate', method: 'withdraw' });
    await intents.withdraw({ opId: 'w3', accountId: 'a.mock', tokenId: WATER, amount: '100', to: 'a.mock' });
    expect(intents.verifierBalance('a.mock', WATER)).toBe(900n);
  });

  it('insufficient_funds fails before any write', async () => {
    const intents = await setup();
    mockChainControls.faults.inject({ kind: 'insufficient_funds' });
    await expect(intents.withdraw({ opId: 'w4', accountId: 'a.mock', tokenId: WATER, amount: '1', to: 'a.mock' })).rejects.toMatchObject({ errorCode: 'NEAR_INSUFFICIENT_BALANCE' });
    expect(intents.verifierBalance('a.mock', WATER)).toBe(1000n);
  });
});
