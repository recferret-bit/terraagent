import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import {
  cargoExportOpId,
  cargoImportOpId,
  NearCargoResponseSchema,
  newId,
} from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import type { PlanetEventOf } from '../../src/bus/channels.js';
import { EventBus } from '../../src/bus/event-bus.js';
import { OutboxRelayService } from '../../src/near/application/outbox/outbox.module.js';
import { toCargoBaseUnits } from '../../src/near/application/ports/cargo-token.port.js';
import { CargoExportOutboxService } from '../../src/near/cargo/cargo-export-outbox.js';
import { CargoRelaySettlementService } from '../../src/near/cargo/cargo-relay-settlement.js';
import {
  CargoStatusService,
  type NearCargoStatusBusEvent,
} from '../../src/near/cargo/cargo-status.service.js';
import { NearModule } from '../../src/near/near.module.js';

void [CargoExportOutboxService, CargoRelaySettlementService, CargoStatusService, NearModule];

let db: TestDatabase;
let app: INestApplication;
let url: string;
let relayService: OutboxRelayService;
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
  await app.listen(0, '127.0.0.1');
  url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  relayService = app.get(OutboxRelayService);
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
  exportSeq?: number;
  resource?: 'metals.t1' | 'minerals.t1' | 'bio.water';
  amount?: number;
}): PlanetEventOf<'cargoExported'> {
  const exportSeq = overrides.exportSeq ?? 1;
  const opId = cargoExportOpId(overrides.colonyId, exportSeq);
  return {
    planetId: overrides.planetId ?? 'pl_w10_status',
    tick: 15,
    kind: 'cargoExported',
    severity: 'info',
    colonyIds: [overrides.colonyId],
    data: {
      colonyId: overrides.colonyId,
      colonyIndex: overrides.colonyIndex ?? 0,
      ref: opId,
      exportSeq,
      resource: overrides.resource ?? 'metals.t1',
      amount: overrides.amount ?? 300,
    },
  };
}

async function waitForPushCount(
  pushes: NearCargoStatusBusEvent[],
  minCount: number,
): Promise<void> {
  const end = Date.now() + 3000;
  while (Date.now() < end && pushes.length < minCount) {
    await new Promise((r) => setTimeout(r, 15));
  }
}

describe('GET /v1/near/cargo & cargo.status push on PENDING -> FINAL (W10-14)', () => {
  it('acceptance: pushes near.cargo.status on PENDING -> FINAL and returns inOrbit, pendingExport, pendingImport, and todayMinted vs dailyCap (20,000)', async () => {
    const colonyId = newId('co');
    const opId = cargoExportOpId(colonyId, 1);
    const statusPushes: NearCargoStatusBusEvent[] = [];
    const unsub = bus.on(
      'near.cargo.status',
      (ev) => {
        if (ev.colonyId === colonyId) statusPushes.push(ev);
      },
      { module: 'cargo-status-test' },
    );

    try {
      bus.emit(
        'planet.event',
        makeCargoExportedEvent({
          planetId: 'pl_w10_status',
          colonyId,
          colonyIndex: 0,
          exportSeq: 1,
          resource: 'metals.t1',
          amount: 300,
        }),
      );

      await waitForPushCount(statusPushes, 1);
      expect(statusPushes.length).toBeGreaterThanOrEqual(1);
      const pendingPush = statusPushes[0]!;
      expect(pendingPush.status.pendingExport?.[0]).toMatchObject({
        ref: opId,
        direction: 'export',
        resource: 'metals.t1',
        amount: 300,
        state: 'PENDING',
      });
      expect(pendingPush.status.todayMinted?.['metals.t1']).toBe(300);
      expect(pendingPush.status.dailyCap).toBe(20_000);

      const pendingRes = await fetch(`${url}/v1/near/cargo?colonyId=${encodeURIComponent(colonyId)}`);
      expect(pendingRes.status).toBe(200);
      const pendingBody = NearCargoResponseSchema.parse(await pendingRes.json());
      expect(pendingBody.pendingExport).toHaveLength(1);
      expect(pendingBody.pendingImport).toEqual([]);
      expect(pendingBody.todayMinted?.['metals.t1']).toBe(300);
      expect(pendingBody.dailyCap).toBe(20_000);

      const countBeforeSettle = statusPushes.length;
      expect(await relayService.pollOnce()).toBe(1);
      await waitForPushCount(statusPushes, countBeforeSettle + 1);
      const finalPush = statusPushes[statusPushes.length - 1]!;
      expect(finalPush.status.inOrbit['metals.t1']).toBe(300);
      expect(finalPush.status.pendingExport).toEqual([]);
      expect(finalPush.status.pending).toEqual([]);

      const importOpId = cargoImportOpId(colonyId, 1);
      await db.prisma.cargoTx.create({
        data: {
          opId: importOpId,
          planetId: 'pl_w10_status',
          colonyId,
          colonyIndex: 0,
          accountId: finalPush.status.accountId,
          direction: 'IMPORT',
          resource: 'metals.t1',
          amount: toCargoBaseUnits(100),
          state: 'PENDING',
          simRef: importOpId,
        },
      });

      const finalRes = await fetch(`${url}/v1/near/cargo?colonyId=${encodeURIComponent(colonyId)}`);
      expect(finalRes.status).toBe(200);
      const finalBody = NearCargoResponseSchema.parse(await finalRes.json());
      expect(finalBody.inOrbit['metals.t1']).toBe(300);
      expect(finalBody.pendingExport).toEqual([]);
      expect(finalBody.pendingImport?.[0]).toMatchObject({
        ref: importOpId,
        direction: 'import',
        resource: 'metals.t1',
        amount: 100,
        state: 'PENDING',
      });
      expect(finalBody.todayMinted?.['metals.t1']).toBe(300);
      expect(finalBody.dailyCap).toBe(20_000);
      expect(finalBody.colonies?.[colonyId]?.inOrbit['metals.t1']).toBe(300);
    } finally {
      unsub();
    }
  });
});

describe('GET /v1/near/cargo wave gate (W10-14)', () => {
  it('returns 404 when wave W10 is disabled', async () => {
    const noW10 = await createApp({
      source: {
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        SIM_THREADS: '1',
        SNAPSHOTS: 'off',
        DATABASE_URL: db.url,
        OUTBOX_RELAY_ENABLED: 'false',
        TA_WAVES: '..09',
      },
    });
    await noW10.app.listen(0, '127.0.0.1');
    try {
      const noW10Url = (await noW10.app.getUrl()).replace('[::1]', '127.0.0.1');
      const res = await fetch(`${noW10Url}/v1/near/cargo?colonyId=col-0`);
      expect(res.status).toBe(404);
    } finally {
      await noW10.app.close();
    }
  });
});
