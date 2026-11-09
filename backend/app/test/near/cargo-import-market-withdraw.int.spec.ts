import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { cargoImportOpId, MARKET_TOKENS, MOCK_ACCOUNT_ROOT, marketWithdrawOpId, newId, toChainUnits, type SimCommandV1 } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import type { PlanetEventOf } from '../../src/bus/channels.js';
import { EventBus } from '../../src/bus/event-bus.js';
import { bridgePlanetEvents } from '../../src/game/bus-bridge.js';
import type { GamePlanets } from '../../src/game/game-planets.service.js';
import { OutboxRelayService } from '../../src/near/application/outbox/outbox.module.js';
import { CARGO_MINTER_ACCOUNT, CargoTokenPort, toCargoBaseUnits } from '../../src/near/application/ports/cargo-token.port.js';
import { IntentsPort } from '../../src/near/application/ports/intents.port.js';
import { CargoImportOutboxService } from '../../src/near/cargo/cargo-import-outbox.js';
import { CargoStatusService } from '../../src/near/cargo/cargo-status.service.js';
import type { NearCargoSettledBusEvent } from '../../src/near/cargo/cargo-relay-settlement.js';

let db: TestDatabase;
let app: INestApplication;
let importOutbox: CargoImportOutboxService;
let relay: OutboxRelayService;
let cargo: CargoTokenPort;
let intents: IntentsPort;
let bus: EventBus;
const METALS = MARKET_TOKENS['metals.t1'].verifierId;

beforeAll(async () => {
  db = await createTestDatabase();
  ({ app } = await createApp({
    source: { NODE_ENV: 'test', LOG_LEVEL: 'silent', SIM_THREADS: '1', SNAPSHOTS: 'off', DATABASE_URL: db.url, OUTBOX_RELAY_ENABLED: 'false', MOCK_LATENCY_MIN_MS: '0', MOCK_LATENCY_MAX_MS: '0' },
  }));
  await app.init();
  importOutbox = app.get(CargoImportOutboxService);
  relay = app.get(OutboxRelayService);
  cargo = app.get(CargoTokenPort, { strict: false });
  intents = app.get(IntentsPort, { strict: false });
  bus = app.get(EventBus);
});
afterAll(async () => {
  await app?.close();
  await db?.drop();
});

const accountOf = (colonyId: string) => `${colonyId.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}.${MOCK_ACCOUNT_ROOT}`;
const imported = (colonyId: string, importSeq: number, amount: number): PlanetEventOf<'cargoImported'> => ({
  planetId: 'pl_w13_16', tick: 30, kind: 'cargoImported', severity: 'info', colonyIds: [colonyId],
  data: { colonyId, colonyIndex: 0, ref: cargoImportOpId(colonyId, importSeq), importSeq, resource: 'metals.t1', amount, phase: 'requested' },
});

/** Mints `n` metals to the colony account and deposits all of it into the verifier (as after a sell/buy settlement). */
async function onlyInVerifier(colonyId: string, n: number): Promise<string> {
  const accountId = accountOf(colonyId);
  await cargo.mint({ opId: `seed:${colonyId}`, to: accountId, tokenId: 'metals.t1', amount: toCargoBaseUnits(n), caller: CARGO_MINTER_ACCOUNT });
  await intents.deposit({ opId: `seed-dep:${colonyId}`, accountId, tokenId: METALS, amount: toChainUnits('metals.t1', String(n)).toString() });
  return accountId;
}

async function pollUntilFinal(opId: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    await relay.pollOnce();
    if ((await db.prisma.cargoTx.findUnique({ where: { opId } }))?.state === 'FINAL') return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`import ${opId} did not reach FINAL`);
}

async function reserveSell(colonyId: string, accountId: string, whole: number): Promise<void> {
  await db.prisma.marketOrder.create({
    data: {
      orderId: `ord-${colonyId}`, ref: `ref-${colonyId}`, planetId: 'pl_w13_16', pair: 'metals.t1/USDC', base: 'metals.t1', quote: 'USDC', side: 'sell',
      colonyId, accountId, stallColonyId: colonyId, stallAccountId: accountId, platformAccountId: 'platform.mock',
      amount: String(whole), priceAmount: '1000000', fillPolicy: 'GTC', policyVersion: 'v1', policyHash: 'h', platformFeeBp: 0, stallFeeBp: 0,
      reservedPrincipal: String(whole), ttlS: 3600, expiresAt: new Date(Date.now() + 3_600_000), state: 'OPEN',
    },
  });
}

describe('cargo import withdraws from the verifier first (W13-16)', () => {
  it('acceptance: 100 metals only in the verifier -> one withdraw, one burn, settled ok, in-orbit shows account + free verifier', async () => {
    const colonyId = newId('co');
    const accountId = await onlyInVerifier(colonyId, 150);
    const opId = cargoImportOpId(colonyId, 1);
    const wOp = marketWithdrawOpId(colonyId, 1);
    expect(await cargo.balanceOf({ accountId, tokenId: 'metals.t1' })).toBe('0');

    const status = app.get(CargoStatusService);
    const before = await status.getColonyCargoStatus({ colonyId, accountId, planetId: 'pl_w13_16' });
    expect(before.inOrbit['metals.t1']).toBe(150);

    const settled: NearCargoSettledBusEvent[] = [];
    const submitted: SimCommandV1[] = [];
    const off = bus.on('near.cargo.settled', (e) => settled.push(e), { module: 'test' });
    const unbridge = bridgePlanetEvents({ onEvents: () => () => undefined, submit: async (_p: string, cmd: SimCommandV1) => (submitted.push(cmd), { ok: true as const, commandId: cmd.commandId, appliedAtTick: 31 }) } as unknown as GamePlanets, bus);
    try {
      expect(await importOutbox.handleCargoImported(imported(colonyId, 1, 100))).toEqual({ opId, accountId, status: 'PENDING' });
      const w = await db.prisma.chainOutbox.findUniqueOrThrow({ where: { opId: wOp } });
      expect([w.port, w.method]).toEqual(['Intents', 'withdraw']);
      expect((await db.prisma.chainOutbox.findUniqueOrThrow({ where: { opId } })).payload).toMatchObject({ dependsOn: wOp });

      await pollUntilFinal(opId);
      const rows = await db.prisma.chainOutbox.findMany({ where: { opId: { in: [wOp, opId] } }, orderBy: { updatedAt: 'asc' } });
      expect(rows.map((r) => [r.method, r.status])).toEqual([['withdraw', 'DONE'], ['burn', 'DONE']]);
      expect(await db.prisma.mockChainReceipt.count({ where: { OR: [{ port: 'Intents', method: 'mt_withdraw', opId: wOp }, { port: 'CargoToken', method: 'mt_burn', opId }] } })).toBe(2);
      expect(await cargo.balanceOf({ accountId, tokenId: 'metals.t1' })).toBe('0');
      const left = await db.prisma.mockChainIntentsBalance.findUniqueOrThrow({ where: { accountId_tokenId: { accountId, tokenId: METALS } } });
      expect(left.amount.toFixed()).toBe(toChainUnits('metals.t1', '50').toString());

      expect(settled).toEqual([expect.objectContaining({ colonyId, direction: 'import', resource: 'metals.t1', amount: 100, ok: true })]);
      expect(submitted.find((c) => c.kind === 'cargo.settled')).toBeDefined();
      const after = await status.getColonyCargoStatus({ colonyId, accountId, planetId: 'pl_w13_16' });
      expect(after.inOrbit['metals.t1']).toBe(50);
    } finally {
      unbridge();
      off();
    }
  });

  it('never withdraws funds reserved by open sell orders; reserved is shown separately', async () => {
    const colonyId = newId('co');
    const accountId = await onlyInVerifier(colonyId, 100);
    await reserveSell(colonyId, accountId, 60);
    const status = await app.get(CargoStatusService).getColonyCargoStatus({ colonyId, accountId, planetId: 'pl_w13_16' });
    expect(status.inOrbit['metals.t1']).toBe(40);
    expect(status.reserved).toEqual({ 'metals.t1': 60 });

    const opId = cargoImportOpId(colonyId, 1);
    expect(await importOutbox.handleCargoImported(imported(colonyId, 1, 50))).toEqual({ opId, accountId, status: 'FAILED', error: 'insufficient_cargo' });
    expect(await db.prisma.chainOutbox.count({ where: { opId: { in: [opId, marketWithdrawOpId(colonyId, 1)] } } })).toBe(0);

    expect(await importOutbox.handleCargoImported(imported(colonyId, 2, 40))).toMatchObject({ status: 'PENDING' });
    await pollUntilFinal(cargoImportOpId(colonyId, 2));
    const left = await db.prisma.mockChainIntentsBalance.findUniqueOrThrow({ where: { accountId_tokenId: { accountId, tokenId: METALS } } });
    expect(left.amount.toFixed()).toBe(toChainUnits('metals.t1', '60').toString());
  });
});
