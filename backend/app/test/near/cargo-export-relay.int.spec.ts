import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { cargoExportOpId, newId, type SimCommandV1 } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import type { PlanetEventOf } from '../../src/bus/channels.js';
import { EventBus } from '../../src/bus/event-bus.js';
import { bridgePlanetEvents } from '../../src/game/bus-bridge.js';
import type { GamePlanets } from '../../src/game/game-planets.service.js';
import { OutboxRelayService } from '../../src/near/application/outbox/outbox.module.js';
import { CargoTokenPort, toCargoBaseUnits } from '../../src/near/application/ports/cargo-token.port.js';
import { CargoExportOutboxService } from '../../src/near/cargo/cargo-export-outbox.js';
import type { NearCargoSettledBusEvent } from '../../src/near/cargo/cargo-relay-settlement.js';
import { mockChainControls } from '../../src/near/infrastructure/mock/mock-controls.js';
import { MOCK_HASH_RE } from '../../src/near/infrastructure/mock/tx-hash.js';

let db: TestDatabase;
let app: INestApplication;
let exportOutbox: CargoExportOutboxService;
let relayService: OutboxRelayService;
let cargoToken: CargoTokenPort;
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
  exportOutbox = app.get(CargoExportOutboxService);
  relayService = app.get(OutboxRelayService);
  cargoToken = app.get(CargoTokenPort, { strict: false });
  bus = app.get(EventBus);
});

afterEach(() => {
  mockChainControls.reset();
});

afterAll(async () => {
  mockChainControls.reset();
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
    planetId: overrides.planetId ?? 'pl_w10_relay',
    tick: 20,
    kind: 'cargoExported',
    severity: 'info',
    colonyIds: [overrides.colonyId],
    data: {
      colonyId: overrides.colonyId,
      colonyIndex: overrides.colonyIndex ?? 1,
      ref: opId,
      exportSeq,
      resource: overrides.resource ?? 'metals.t1',
      amount: overrides.amount ?? 300,
    },
  };
}

function captureSettlement() {
  const settledEvents: NearCargoSettledBusEvent[] = [];
  const submittedCmds: Array<{ planetId: string; cmd: SimCommandV1 }> = [];
  const unsubBus = bus.on('near.cargo.settled', (ev) => settledEvents.push(ev), { module: 'test' });
  const fakePlanets = {
    onEvents: () => () => undefined,
    submit: async (planetId: string, cmd: SimCommandV1) => {
      submittedCmds.push({ planetId, cmd });
      return { ok: true as const, commandId: cmd.commandId, appliedAtTick: 21 };
    },
  } as unknown as GamePlanets;
  const unsubBridge = bridgePlanetEvents(fakePlanets, bus);
  return {
    settledEvents,
    submittedCmds,
    cleanup() {
      unsubBridge();
      unsubBus();
    },
  };
}

describe('CargoExport outbox relay happy path (W10-09)', () => {
  it('acceptance 1: mints cargo tokens, marks cargo_tx FINAL with txHash, and emits near.cargo.settled{ok:true} + submits cargo.settled', async () => {
    const colonyId = newId('co');
    const opId = cargoExportOpId(colonyId, 1);
    const { settledEvents, submittedCmds, cleanup } = captureSettlement();

    try {
      const enqueued = await exportOutbox.handleCargoExported(
        makeCargoExportedEvent({
          planetId: 'pl_w10_happy',
          colonyId,
          colonyIndex: 2,
          exportSeq: 1,
          resource: 'metals.t1',
          amount: 300,
        }),
      );
      expect(enqueued).not.toBeNull();
      await expect.poll(() => relayService.pollOnce(), { timeout: 10_000 }).toBe(1);

      const cargoTx = await db.prisma.cargoTx.findUniqueOrThrow({ where: { opId } });
      expect(cargoTx.state).toBe('FINAL');
      expect(cargoTx.txHash).toMatch(MOCK_HASH_RE);
      expect(cargoTx.lastError).toBeNull();

      const outboxRow = await db.prisma.chainOutbox.findUniqueOrThrow({ where: { opId } });
      expect(outboxRow.status).toBe('DONE');
      expect(outboxRow.txHash).toBe(cargoTx.txHash);

      const balance = await cargoToken.balanceOf({
        accountId: enqueued!.accountId,
        tokenId: 'metals.t1',
      });
      expect(balance).toBe(toCargoBaseUnits(300));

      expect(settledEvents).toEqual([
        {
          planetId: 'pl_w10_happy',
          colonyId,
          colonyIndex: 2,
          ref: opId,
          opId,
          direction: 'export',
          resource: 'metals.t1',
          amount: 300,
          ok: true,
          txHash: cargoTx.txHash ?? undefined,
        },
      ]);

      const matchingCmd = submittedCmds.find(
        (c) => c.planetId === 'pl_w10_happy' && c.cmd.kind === 'cargo.settled',
      );
      expect(matchingCmd).toBeDefined();
      expect(matchingCmd!.cmd.source).toBe('near');
      expect(matchingCmd!.cmd.colonyIndex).toBe(2);
      expect(matchingCmd!.cmd.commandId.length).toBeLessThanOrEqual(40);
      expect(matchingCmd!.cmd.args).toEqual({
        colonyId,
        ref: opId,
        direction: 'export',
        resource: 'metals.t1',
        amount: 300,
        ok: true,
        txHash: cargoTx.txHash,
      });
    } finally {
      cleanup();
    }
  });
});

describe('CargoExport outbox relay forced failure (W10-09)', () => {
  it('acceptance 2: after retries exhaust, marks cargo_tx FAILED and chain_outbox DEAD and emits near.cargo.settled{ok:false}', async () => {
    mockChainControls.setFail('cargo', 1);

    const colonyId = newId('co');
    const opId = cargoExportOpId(colonyId, 1);
    const { settledEvents, submittedCmds, cleanup } = captureSettlement();

    try {
      const enqueued = await exportOutbox.handleCargoExported(
        makeCargoExportedEvent({
          planetId: 'pl_w10_fail',
          colonyId,
          colonyIndex: 1,
          exportSeq: 1,
          resource: 'minerals.t1',
          amount: 150,
        }),
      );
      expect(enqueued).not.toBeNull();

      // First attempt fails -> status FAILED on outbox, SENT on cargo_tx, not dead yet
      await expect.poll(() => relayService.pollOnce(), { timeout: 10_000 }).toBe(1);
      const txAfterFirst = await db.prisma.cargoTx.findUniqueOrThrow({ where: { opId } });
      expect(txAfterFirst.state).toBe('SENT');
      expect(txAfterFirst.lastError).toContain('NEAR_MOCK_INJECTED_FAILURE');
      expect(settledEvents).toHaveLength(0);

      // Make the retry due immediately and run the final attempt (maxAttemptsFor CargoToken = 2)
      await db.prisma.$executeRaw`UPDATE chain.chain_outbox SET next_attempt_at = now() - interval '1 second' WHERE op_id = ${opId}`;
      await expect.poll(() => relayService.pollOnce(), { timeout: 10_000 }).toBe(1);

      const txAfterDead = await db.prisma.cargoTx.findUniqueOrThrow({ where: { opId } });
      expect(txAfterDead.state).toBe('FAILED');
      expect(txAfterDead.lastError).toContain('NEAR_MOCK_INJECTED_FAILURE');

      const outboxAfterDead = await db.prisma.chainOutbox.findUniqueOrThrow({ where: { opId } });
      expect(outboxAfterDead.status).toBe('DEAD');
      expect(outboxAfterDead.attempts).toBe(2);

      const balance = await cargoToken.balanceOf({
        accountId: enqueued!.accountId,
        tokenId: 'minerals.t1',
      });
      expect(balance).toBe('0');

      expect(settledEvents).toHaveLength(1);
      expect(settledEvents[0]).toMatchObject({
        planetId: 'pl_w10_fail',
        colonyId,
        colonyIndex: 1,
        ref: opId,
        opId,
        direction: 'export',
        resource: 'minerals.t1',
        amount: 150,
        ok: false,
      });
      expect(settledEvents[0]?.error).toContain('NEAR_MOCK_INJECTED_FAILURE');

      const matchingCmd = submittedCmds.find(
        (c) => c.planetId === 'pl_w10_fail' && c.cmd.kind === 'cargo.settled',
      );
      expect(matchingCmd).toBeDefined();
      expect(matchingCmd!.cmd.source).toBe('near');
      expect(matchingCmd!.cmd.args).toMatchObject({
        colonyId,
        ref: opId,
        direction: 'export',
        resource: 'minerals.t1',
        amount: 150,
        ok: false,
      });
    } finally {
      cleanup();
    }
  });
});
