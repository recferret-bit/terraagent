import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EscrowPort } from '../../src/near/application/ports/escrow.port.js';
import { NearException } from '../../src/near/domain/errors.js';
import { nearAdapterFor } from '../../src/near/infrastructure/adapter-selection.js';
import { MockCargoTokenAdapter } from '../../src/near/infrastructure/adapters/cargo/mock-cargo-token.adapter.js';
import { escrowHoldAccount, escrowIdFromOp } from '../../src/near/infrastructure/adapters/mock/escrow-id.js';
import { MockEscrowAdapter } from '../../src/near/infrastructure/adapters/mock/escrow.adapter.js';
import { nearAdapters } from '../../src/near/infrastructure/near-infrastructure.module.js';

let db: TestDatabase;
const sleep = async () => undefined;
const cfg = () => ({ latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 7 });
const escrow = () => new MockEscrowAdapter(db.prisma, cfg(), { sleep });
const TOKEN = 'metals.t1';
const BENEFICIARY = 'bounty.escrow.terraagent.mock';

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.drop();
});

async function fund(accountId: string, amount: string, opId: string): Promise<void> {
  await new MockCargoTokenAdapter(db.prisma, cfg(), { sleep }).mint({ opId, to: accountId, tokenId: TOKEN, amount });
}

const bal = async (accountId: string): Promise<string> => {
  const row = await db.prisma.mockChainBalance.findUnique({
    where: { accountId_tokenId: { accountId, tokenId: TOKEN } },
  });
  return row?.amount.toFixed() ?? '0';
};

describe('MockEscrowAdapter (W22-17)', () => {
  it('binds NEAR_ADAPTER_ESCROW to the mock', () => {
    expect(nearAdapterFor('Escrow', { NEAR_ADAPTER_ESCROW: 'mock' })).toBe('mock');
    expect(nearAdapters.some((a) => a.port === EscrowPort && a.kind === 'mock' && a.useClass === MockEscrowAdapter)).toBe(true);
  });

  it('open 200 metals debits the poster and credits the escrow hold', async () => {
    const poster = 'w2217-poster.terraagent.mock';
    await fund(poster, '500', 'w2217:fund:poster');
    const opened = await escrow().open({
      opId: 'w2217:open:poster',
      funder: poster,
      beneficiary: BENEFICIARY,
      tokenId: TOKEN,
      amount: '200',
      expiresAtMs: 1_700_000_000_000,
    });
    const hold = escrowHoldAccount(opened.escrowId);
    expect(opened.escrowId).toBe(escrowIdFromOp('w2217:open:poster'));
    expect(opened.receipt.status).toBe('success');
    expect(await bal(poster)).toBe('300');
    expect(await bal(hold)).toBe('200');
    const view = await escrow().get({ escrowId: opened.escrowId });
    expect(view).toMatchObject({
      escrowId: opened.escrowId,
      status: 'open',
      funder: poster,
      beneficiary: BENEFICIARY,
      tokenId: TOKEN,
      amount: '200',
      expiresAtMs: 0,
    });
  });
});

describe('MockEscrowAdapter claim and refund (W22-17)', () => {
  it('rejects an overdraft, a second claim, and a refund after claim', async () => {
    const poor = 'w2217-poor.terraagent.mock';
    await fund(poor, '100', 'w2217:fund:poor');
    await expect(escrow().open({
      opId: 'w2217:open:poor',
      funder: poor,
      beneficiary: BENEFICIARY,
      tokenId: TOKEN,
      amount: '200',
      expiresAtMs: 0,
    })).rejects.toMatchObject({ errorCode: 'NEAR_INSUFFICIENT_BALANCE' });
    expect(await bal(poor)).toBe('100');
    expect(await db.prisma.mockChainEscrow.count({ where: { opener: poor } })).toBe(0);

    const poster = 'w2217-claim-poster.terraagent.mock';
    const claimer = 'w2217-claimer.terraagent.mock';
    await fund(poster, '500', 'w2217:fund:claim');
    const opened = await escrow().open({
      opId: 'w2217:open:claim',
      funder: poster,
      beneficiary: BENEFICIARY,
      tokenId: TOKEN,
      amount: '200',
      expiresAtMs: 0,
    });
    await escrow().claim({ opId: 'w2217:claim:1', escrowId: opened.escrowId, caller: claimer });
    await expect(escrow().claim({ opId: 'w2217:claim:2', escrowId: opened.escrowId, caller: claimer }))
      .rejects.toMatchObject({ name: NearException.name, errorCode: 'NEAR_ESCROW_STATE' });
    await expect(escrow().refund({ opId: 'w2217:refund:claimed', escrowId: opened.escrowId, caller: poster }))
      .rejects.toMatchObject({ errorCode: 'NEAR_ESCROW_STATE' });
    expect(await bal(claimer)).toBe('200');
    expect(await bal(escrowHoldAccount(opened.escrowId))).toBe('0');
    expect(await bal(BENEFICIARY)).toBe('0');
    expect((await escrow().get({ escrowId: opened.escrowId })).status).toBe('claimed');
  });

  it('replays open by opId, refunds the poster exactly, and misses an unknown id', async () => {
    const poster = 'w2217-idem.terraagent.mock';
    await fund(poster, '500', 'w2217:fund:idem');
    const input = {
      opId: 'w2217:open:idem',
      funder: poster,
      beneficiary: BENEFICIARY,
      tokenId: TOKEN,
      amount: '200',
      expiresAtMs: 50,
    };
    const first = await escrow().open(input);
    const second = await escrow().open(input);
    expect(second.escrowId).toBe(first.escrowId);
    expect(second.receipt.txHash).toBe(first.receipt.txHash);
    expect(await bal(poster)).toBe('300');
    expect(await bal(escrowHoldAccount(first.escrowId))).toBe('200');
    expect(await db.prisma.mockChainEscrow.count({ where: { id: first.escrowId } })).toBe(1);

    const refunded = await escrow().refund({ opId: 'w2217:refund:idem', escrowId: first.escrowId, caller: poster });
    expect(refunded.status).toBe('success');
    const again = await escrow().refund({ opId: 'w2217:refund:idem', escrowId: first.escrowId, caller: poster });
    expect(again.txHash).toBe(refunded.txHash);
    expect(await bal(poster)).toBe('500');
    expect(await bal(escrowHoldAccount(first.escrowId))).toBe('0');
    expect((await escrow().get({ escrowId: first.escrowId })).status).toBe('refunded');

    await expect(escrow().get({ escrowId: 'escrow:missing' })).rejects.toMatchObject({ errorCode: 'NEAR_ESCROW_NOT_FOUND' });
  });
});
