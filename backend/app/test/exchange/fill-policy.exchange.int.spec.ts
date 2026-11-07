import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Exchange, ord } from './exchange-harness.js';

let ex: Exchange;
beforeAll(async () => { ex = await Exchange.boot(); });
afterAll(async () => { await ex?.close(); });

const body = (side: 'sell' | 'buy', fillPolicy?: string) => ({ ...ord(side, 10, 1_000_000), ...(fillPolicy ? { fillPolicy } : {}) });

describe('fillPolicy is a property of the account (ECONOMY section 3: custodial partial, claimed all-or-nothing)', () => {
  it('a custodial account may state partial but all_or_nothing is fill_policy_not_allowed (422, nothing placed)', async () => {
    const w = ex.world();
    const a = await w.bot();
    const aon = await ex.api('POST', '/trade/orders', { auth: a.secret, idem: `fp${Date.now()}a`, body: body('sell', 'all_or_nothing') });
    expect(aon.status).toBe(422);
    expect(aon.body.error).toMatchObject({ code: 'fill_policy_not_allowed', details: { allowed: 'partial' } });
    const ok = await ex.api('POST', '/trade/orders', { auth: a.secret, idem: `fp${Date.now()}b`, body: body('sell', 'partial') });
    expect(ok.status).toBe(201);
    expect(ok.body.order.fillPolicy).toBe('partial');
  });

  it('a claimed account may state all_or_nothing (pinned on the order) but not partial', async () => {
    const w = ex.world();
    const a = await w.bot();
    await ex.prisma.nearColonyAccount.updateMany({ where: { accountId: a.accountId }, data: { claimedAt: new Date() } });
    const part = await ex.api('POST', '/trade/orders', { auth: a.secret, idem: `fp${Date.now()}c`, body: body('sell', 'partial') });
    expect(part.status).toBe(422);
    expect(part.body.error).toMatchObject({ code: 'fill_policy_not_allowed', details: { allowed: 'all_or_nothing' } });
    const ok = await ex.api('POST', '/trade/orders', { auth: a.secret, idem: `fp${Date.now()}d`, body: body('sell', 'all_or_nothing') });
    expect(ok.status).toBe(201);
    expect(ok.body.order.fillPolicy).toBe('all_or_nothing');
    const omitted = await ex.api('POST', '/trade/orders', { auth: a.secret, idem: `fp${Date.now()}e`, body: body('sell') });
    expect(omitted.body.order.fillPolicy).toBe('all_or_nothing');
  });
});
