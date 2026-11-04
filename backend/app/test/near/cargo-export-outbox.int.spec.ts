import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { cargoExportOpId, newId } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import type { PlanetEventOf } from '../../src/bus/channels.js';
import { EventBus } from '../../src/bus/event-bus.js';
import { CARGO_MINTER_ACCOUNT, toCargoBaseUnits } from '../../src/near/application/ports/cargo-token.port.js';
import { CargoExportOutboxService } from '../../src/near/cargo/cargo-export-outbox.js';

let db: TestDatabase;
let app: INestApplication;
let service: CargoExportOutboxService;
let bus: EventBus;

beforeAll(async () => {
  db = await createTestDatabase();
  const created = await createApp({
    source: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      SIM_THREADS: '1',
      SNAPSHOTS: 'off',
      DATABASE_URL: db.url,
      OUTBOX_RELAY_ENABLED: 'false',
      MOCK_LATENCY_MIN_MS: '0',
      MOCK_LATENCY_MAX_MS: '0',
    },
  });
  app = created.app;
  await app.init();
  service = app.get(CargoExportOutboxService);
  bus = app.get(EventBus);
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
});

function makeCargoExportedEvent(overrides: {
  planetId?: string;
  colonyId: string;
  colonyIndex?: number;
  playerId?: string;
  exportSeq?: number;
  resource?: 'metals.t1' | 'minerals.t1' | 'bio.water';
  amount?: number;
}): PlanetEventOf<'cargoExported'> {
  const exportSeq = overrides.exportSeq ?? 1;
  const opId = cargoExportOpId(overrides.colonyId, exportSeq);
  return {
    planetId: overrides.planetId ?? 'pl_w10_test',
    tick: 12,
    kind: 'cargoExported',
    severity: 'info',
    colonyIds: [overrides.colonyId],
    data: {
      colonyId: overrides.colonyId,
      colonyIndex: overrides.colonyIndex ?? 0,
      ...(overrides.playerId ? { playerId: overrides.playerId } : {}),
      ref: opId,
      exportSeq,
      resource: overrides.resource ?? 'metals.t1',
      amount: overrides.amount ?? 300,
    },
  };
}

describe('CargoExportOutboxService enqueue & idempotency (W10-08)', () => {
  it('acceptance: writes chain.cargo_tx (EXPORT, PENDING) and chain_outbox row in one tx and is idempotent on replay', async () => {
    const colonyId = newId('co');
    const opId = cargoExportOpId(colonyId, 1);
    const event = makeCargoExportedEvent({
      colonyId,
      colonyIndex: 2,
      exportSeq: 1,
      resource: 'metals.t1',
      amount: 300,
    });

    const first = await service.handleCargoExported(event);
    expect(first).not.toBeNull();
    expect(first?.opId).toBe(opId);

    const cargoTx = await db.prisma.cargoTx.findUnique({ where: { opId } });
    expect(cargoTx).not.toBeNull();
    expect(cargoTx).toMatchObject({
      opId,
      planetId: 'pl_w10_test',
      colonyId,
      colonyIndex: 2,
      accountId: first?.accountId,
      direction: 'EXPORT',
      resource: 'metals.t1',
      state: 'PENDING',
      simRef: opId,
    });
    expect(cargoTx?.amount.toFixed()).toBe(toCargoBaseUnits(300));

    const outboxRow = await db.prisma.chainOutbox.findUnique({ where: { opId } });
    expect(outboxRow).not.toBeNull();
    expect(outboxRow).toMatchObject({
      opId,
      port: 'CargoToken',
      method: 'mint',
      status: 'PENDING',
    });
    expect(outboxRow?.payload).toMatchObject({
      to: first?.accountId,
      tokenId: 'metals.t1',
      amount: toCargoBaseUnits(300),
      by: CARGO_MINTER_ACCOUNT,
      caller: CARGO_MINTER_ACCOUNT,
      colonyId,
      planetId: 'pl_w10_test',
      colonyIndex: 2,
      resource: 'metals.t1',
      majorAmount: 300,
      exportSeq: 1,
      direction: 'EXPORT',
    });

    // Replay the exact same cargoExported event: still 1 row in each table
    const second = await service.handleCargoExported(event);
    expect(second).toEqual(first);

    expect(await db.prisma.cargoTx.count({ where: { opId } })).toBe(1);
    expect(await db.prisma.chainOutbox.count({ where: { opId } })).toBe(1);

    const cargoTxAfter = await db.prisma.cargoTx.findUnique({ where: { opId } });
    const outboxAfter = await db.prisma.chainOutbox.findUnique({ where: { opId } });
    expect(cargoTxAfter?.id).toBe(cargoTx?.id);
    expect(outboxAfter?.id).toBe(outboxRow?.id);
  });
});

describe('CargoExportOutboxService EventBus & colony account lookup (W10-08)', () => {
  it('resolves existing near_colony_account when present and reacts to planet.event on the EventBus', async () => {
    const colonyId = newId('co');
    const playerId = newId('pl');
    const colonyAcct = `${colonyId.toLowerCase()}.pilot.terraagent.mock`;

    await db.prisma.nearColonyAccount.create({
      data: {
        accountId: colonyAcct,
        playerId,
        slot: colonyId,
        colonyId,
        ownerAccountId: 'pilot.terraagent.mock',
        publicKey: 'ed25519:testkey',
        encryptedSecret: 'cipher',
        kekVersion: 1,
      },
    });

    const opId = cargoExportOpId(colonyId, 3);
    bus.emit(
      'planet.event',
      makeCargoExportedEvent({
        colonyId,
        playerId,
        exportSeq: 3,
        resource: 'minerals.t1',
        amount: 125,
      }),
    );

    const end = Date.now() + 3000;
    while (Date.now() < end) {
      const row = await db.prisma.cargoTx.findUnique({ where: { opId } });
      if (row) break;
      await new Promise((r) => setTimeout(r, 15));
    }

    const cargoTx = await db.prisma.cargoTx.findUnique({ where: { opId } });
    const outboxRow = await db.prisma.chainOutbox.findUnique({ where: { opId } });
    expect(cargoTx?.accountId).toBe(colonyAcct);
    expect(cargoTx?.amount.toFixed()).toBe(toCargoBaseUnits(125));
    expect(outboxRow?.status).toBe('PENDING');
    expect(outboxRow?.payload).toMatchObject({
      to: colonyAcct,
      tokenId: 'minerals.t1',
      amount: toCargoBaseUnits(125),
    });
  });
});
