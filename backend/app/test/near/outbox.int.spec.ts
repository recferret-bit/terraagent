import type { PrismaClient } from '@terra/db';
import { withTransaction } from '@terra/db';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChainOutboxRepository } from '../../src/near/application/outbox/chain-outbox.repository';
import { opId } from '../../src/near/application/outbox/op-id';
import { backoffMs, OutboxRelay, type OutboxRelayConfig } from '../../src/near/application/outbox/outbox-relay';
import type { ChainReceipt } from '../../src/near/domain/types';
import { MockChainBase } from '../../src/near/infrastructure/mock/mock-chain.base';

/** Test-only adapter: a mock chain write whose behaviour the test steers. */
class OutboxFixture extends MockChainBase {
  calls = 0;
  /** When set, the call completes (receipt committed) and then never returns: the relay process "dies" mid-call. */
  hangAfterWrite = false;
  async transfer(input: { opId: string; to: string; amount: string }): Promise<ChainReceipt> {
    this.calls++;
    const receipt = await this.call('Fixture', 'transfer', input.opId, async (tx) => {
      await this.credit(tx, input.to, 'CARGO', input.amount);
      return { to: input.to, amount: input.amount };
    });
    if (this.hangAfterWrite) await new Promise<never>(() => undefined);
    return receipt;
  }
}

let db: TestDatabase;
let prisma: PrismaClient;
let repo: ChainOutboxRepository;
const cfg = (o: Partial<OutboxRelayConfig> = {}): OutboxRelayConfig => ({ pollMs: 20, leaseMs: 300, maxAttempts: 3, batch: 10, backoffBaseMs: 10, backoffMaxMs: 100, ...o });
const adapter = (failRate = 0) => new OutboxFixture(prisma, { latencyMinMs: 1, latencyMaxMs: 3, failRate, seed: 7 });
const relayFor = (a: OutboxFixture, c = cfg()) => new OutboxRelay(repo, c, { resolve: () => a, random: () => 0.5 });
const entry = (id: string, to = 'alice.near') => ({ opId: id, port: 'BadgeNft' as const, method: 'transfer', payload: { to, amount: '5' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(fn: () => Promise<T | false>, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timed out');
    await sleep(15);
  }
}

beforeAll(async () => {
  db = await createTestDatabase();
  prisma = db.prisma;
  repo = new ChainOutboxRepository(prisma);
  await prisma.$executeRawUnsafe('CREATE TABLE public.fake_game_change (id text PRIMARY KEY)');
});
afterAll(async () => { await db?.drop(); });

describe('opId helper', () => {
  it('builds deterministic ids and validates them', () => {
    expect(opId('cargo-export', 'col_1', 7)).toBe('cargo-export:col_1:7');
    expect(() => opId('Bad Kind', 'x')).toThrow();
    expect(() => opId('cargo-export')).toThrow();
    expect(() => opId('k', 'x'.repeat(200))).toThrow();
  });
});

describe('enqueue', () => {
  it('commits with the game change and rolls back with it', async () => {
    const fake = (tx: { $executeRaw: PrismaClient['$executeRaw'] }, id: string) => tx.$executeRaw`INSERT INTO public.fake_game_change (id) VALUES (${id})`;
    await withTransaction(prisma, async (tx) => { await fake(tx, 'ok'); await repo.enqueue(entry('tx-ok:1:1'), tx); });
    const boom = withTransaction(prisma, async (tx) => { await fake(tx, 'bad'); await repo.enqueue(entry('tx-bad:1:1'), tx); throw new Error('rollback'); });
    await expect(boom).rejects.toThrow('rollback');
    expect(await repo.find('tx-ok:1:1')).not.toBeNull();
    expect(await repo.find('tx-bad:1:1')).toBeNull();
    expect(await prisma.$queryRaw`SELECT id FROM public.fake_game_change`).toEqual([{ id: 'ok' }]);
    await prisma.chainOutbox.deleteMany();
  });

  it('the same opId twice is one row', async () => {
    const a = await repo.enqueue(entry('dup:1:1'));
    const b = await repo.enqueue(entry('dup:1:1', 'other.near'));
    expect(b.id).toBe(a.id);
    expect(b.payload).toEqual(a.payload);
    expect(await prisma.chainOutbox.count({ where: { opId: 'dup:1:1' } })).toBe(1);
    await prisma.chainOutbox.deleteMany();
  });
});

describe('relay', () => {
  it('ACCEPTANCE: enqueue twice, relay dies mid-call, relay B after lease expiry -> DONE with exactly one receipt', async () => {
    const id = opId('cargo-export', 'col_1', 1);
    await repo.enqueue(entry(id));
    await repo.enqueue(entry(id));

    const a = adapter();
    a.hangAfterWrite = true;
    void relayFor(a).pollOnce(); // relay A: claims, the adapter commits its receipt, the process "dies" before marking DONE
    const stuck = await waitFor(async () => (await prisma.mockChainReceipt.count({ where: { opId: id } })) === 1 && (await repo.find(id)));
    expect(stuck && stuck.status).toBe('RUNNING');
    const firstReceipt = await prisma.mockChainReceipt.findUniqueOrThrow({ where: { opId: id } });

    const b = adapter();
    expect(await relayFor(b).pollOnce()).toBe(0); // lease still held
    await sleep(350);
    expect(await relayFor(b).pollOnce()).toBe(1); // lease expired: reclaimed

    const row = await repo.find(id);
    const receipts = await prisma.mockChainReceipt.count({ where: { opId: id } });
    const balance = (await prisma.mockChainBalance.findFirstOrThrow({ where: { accountId: 'alice.near', tokenId: 'CARGO' } })).amount.toFixed();
    console.log('acceptance:', { outboxRows: await prisma.chainOutbox.count({ where: { opId: id } }), status: row?.status, attempts: row?.attempts, receipts, balance, adapterBCalls: b.calls });
    expect(row).toMatchObject({ status: 'DONE', attempts: 2, txHash: firstReceipt.txHash });
    expect((row!.receipt as ChainReceipt).txHash).toBe(firstReceipt.txHash);
    expect(receipts).toBe(1);
    expect(balance).toBe('5'); // the effect ran once
    expect(await prisma.chainOutbox.count({ where: { opId: id } })).toBe(1);
  });

  it('retries with backoff, goes DEAD after maxAttempts, last error kept', async () => {
    const id = opId('fail', 'col_2', 1);
    await repo.enqueue(entry(id));
    const relay = relayFor(adapter(1), cfg({ maxAttempts: 3, backoffBaseMs: 40, backoffMaxMs: 1000 }));
    expect(await relay.pollOnce()).toBe(1);
    const first = (await repo.find(id))!;
    expect(first).toMatchObject({ status: 'FAILED', attempts: 1 });
    expect(first.lastError).toContain('NEAR_MOCK_INJECTED_FAILURE');
    expect(first.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() - 5); // pushed into the future
    expect(await relay.pollOnce()).toBe(0); // not due yet
    for (let i = 0; i < 2; i++) await waitFor(async () => (await relay.pollOnce()) === 1);
    const dead = (await repo.find(id))!;
    expect(dead).toMatchObject({ status: 'DEAD', attempts: 3 });
    expect(await relay.pollOnce()).toBe(0);
    expect(await repo.counts()).toMatchObject({ dead: 1 });
  });

  it('a failed row succeeds on a later attempt once the chain recovers', async () => {
    const id = opId('recover', 'col_3', 1);
    await repo.enqueue(entry(id));
    await relayFor(adapter(1), cfg({ backoffBaseMs: 10 })).pollOnce();
    const good = relayFor(adapter(0));
    await waitFor(async () => (await good.pollOnce()) === 1);
    expect(await repo.find(id)).toMatchObject({ status: 'DONE', attempts: 2 });
  });

  it('claims in nextAttemptAt order and runs the polling loop until drained', async () => {
    await prisma.chainOutbox.deleteMany();
    const ids = ['order:a:1', 'order:b:1', 'order:c:1'];
    for (const id of ids) await repo.enqueue(entry(id));
    await prisma.$executeRaw`UPDATE chain.chain_outbox SET next_attempt_at = now() - interval '1 minute' WHERE op_id = 'order:c:1'`;
    await prisma.$executeRaw`UPDATE chain.chain_outbox SET next_attempt_at = now() - interval '2 minute' WHERE op_id = 'order:b:1'`;
    const claimed = await repo.claimDue(2, 1000);
    expect(claimed.map((r) => r.opId)).toEqual(['order:b:1', 'order:c:1']);
    await prisma.$executeRaw`UPDATE chain.chain_outbox SET status = 'PENDING'::chain.outbox_status, locked_until = NULL`;
    const relay = relayFor(adapter());
    relay.start();
    await waitFor(async () => (await prisma.chainOutbox.count({ where: { status: 'DONE' } })) === 3);
    await relay.stop();
    expect(await repo.counts()).toEqual({ pending: 0, dead: 0 });
  });

  it('two relays never process the same row twice', async () => {
    await prisma.chainOutbox.deleteMany();
    for (let i = 0; i < 12; i++) await repo.enqueue(entry(`par:col:${i}`));
    const a = adapter(), b = adapter();
    await Promise.all([relayFor(a, cfg({ batch: 12 })).pollOnce(), relayFor(b, cfg({ batch: 12 })).pollOnce()]);
    expect(a.calls + b.calls).toBe(12);
    expect(await prisma.chainOutbox.count({ where: { status: 'DONE' } })).toBe(12);
  });
});

describe('backoffMs', () => {
  it('doubles, caps and jitters into the upper half', () => {
    const c = { backoffBaseMs: 1000, backoffMaxMs: 600_000 };
    expect(backoffMs(1, c, () => 1)).toBe(2000);
    expect(backoffMs(3, c, () => 0)).toBe(4000);
    expect(backoffMs(20, c, () => 1)).toBe(600_000);
  });
});
