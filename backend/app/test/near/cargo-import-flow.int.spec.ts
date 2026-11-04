import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { cargoImportOpId, MOCK_ACCOUNT_ROOT, newId, parseWaves, type SimCommandV1 } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import {
  applyEnvironmentState,
  compileData,
  createRegistryPipeline,
  createState,
  ensureColonyCargoState,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  environmentFromPlanetTime,
  getColonyStock,
  insertRow,
  setColonyStock,
  setPlanetTime,
  step,
  type SimCommand,
} from '@terra/sim';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import type { PlanetEventOf } from '../../src/bus/channels.js';
import { EventBus } from '../../src/bus/event-bus.js';
import { bridgePlanetEvents } from '../../src/game/bus-bridge.js';
import type { GamePlanets } from '../../src/game/game-planets.service.js';
import { OutboxRelayService } from '../../src/near/application/outbox/outbox.module.js';
import {
  CARGO_MINTER_ACCOUNT,
  CargoTokenPort,
  toCargoBaseUnits,
} from '../../src/near/application/ports/cargo-token.port.js';
import { CargoImportOutboxService } from '../../src/near/cargo/cargo-import-outbox.js';
import type { NearCargoSettledBusEvent } from '../../src/near/cargo/cargo-relay-settlement.js';
import { mockChainControls } from '../../src/near/infrastructure/mock/mock-controls.js';
import { MOCK_HASH_RE } from '../../src/near/infrastructure/mock/tx-hash.js';

let db: TestDatabase;
let app: INestApplication;
let importOutbox: CargoImportOutboxService;
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
  importOutbox = app.get(CargoImportOutboxService);
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

function makeCargoImportedEvent(overrides: {
  planetId?: string;
  colonyId: string;
  colonyIndex?: number;
  importSeq?: number;
  resource?: 'metals.t1' | 'minerals.t1' | 'bio.water';
  amount?: number;
  phase?: 'requested' | 'settled';
}): PlanetEventOf<'cargoImported'> {
  const importSeq = overrides.importSeq ?? 1;
  const opId = cargoImportOpId(overrides.colonyId, importSeq);
  return {
    planetId: overrides.planetId ?? 'pl_w10_import',
    tick: 30,
    kind: 'cargoImported',
    severity: 'info',
    colonyIds: [overrides.colonyId],
    data: {
      colonyId: overrides.colonyId,
      colonyIndex: overrides.colonyIndex ?? 1,
      ref: opId,
      importSeq,
      resource: overrides.resource ?? 'metals.t1',
      amount: overrides.amount ?? 100,
      phase: overrides.phase ?? 'requested',
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
      return { ok: true as const, commandId: cmd.commandId, appliedAtTick: 31 };
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

function defaultAccountForColony(colonyId: string): string {
  const stem = colonyId.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  return `${stem}.${MOCK_ACCOUNT_ROOT}`;
}

function verifySimSettlementCreditsStock(colonyId: string, settledCmd: SimCommandV1): void {
  const state = createState({
    planetId: 'pl_w10_import_happy',
    planetType: 'temperate',
    seed: 'w10-13-import',
    radius: 10,
  });
  const w10 = compileData(parseWaves('..10'));
  setPlanetTime(state, { timeOfDay: 12 }, 0, w10);
  applyEnvironmentState(state, environmentFromPlanetTime(state, w10, false, 0), 0);
  state.colonies[0] = {
    index: 0,
    id: colonyId,
    name: 'Beta Colony',
    color: 0xff6b00,
    status: 'active',
    changedAt: 0,
  };
  ensureColonyLedger(state.colonies[0]);
  setColonyStock(state, 0, { 'metals.t1': 50 });
  const row = insertRow(state.entities, state.meta.nextEntityId++, 0);
  state.entities.cols.kind[row] = ENTITY_KIND.commandHub;
  state.entities.cols.owner[row] = 0;
  state.entities.cols.footprintW[row] = 3;
  state.entities.cols.footprintD[row] = 3;
  state.entities.cols.hp[row] = 1500;
  state.entities.cols.hpMax[row] = 1500;
  state.entities.cols.state[row] = ENTITY_STATE.active;

  const cargoState = ensureColonyCargoState(state.colonies[0]);
  const opId = cargoImportOpId(colonyId, 1);
  cargoState.pendingImport[opId] = {
    ref: opId,
    importSeq: 1,
    resource: 'metals.t1',
    amount: 100,
    atTick: 30,
  };
  cargoState.reservedByFamily.metals = 100;

  const pipeline = createRegistryPipeline({ flags: parseWaves('..10'), data: w10 });
  const stepRes = step(state, [settledCmd as unknown as SimCommand], 1, pipeline);
  expect(stepRes.outcomes[0]?.code).toBeUndefined();
  expect(getColonyStock(state, 0)['metals.t1']).toBe(150);
  expect(cargoState.pendingImport[opId]).toBeUndefined();
  expect(cargoState.reservedByFamily.metals).toBe(0);
}

describe('CargoImport outbox & relay happy path (W10-13)', () => {
  it('acceptance 1: with 200 in orbit, importing 100 burns 100 (leaving 100 in orbit), marks cargo_tx FINAL, and settles 100 into colony stock', async () => {
    const colonyId = newId('co');
    const accountId = defaultAccountForColony(colonyId);
    const opId = cargoImportOpId(colonyId, 1);
    const { settledEvents, submittedCmds, cleanup } = captureSettlement();

    try {
      await cargoToken.mint({
        opId: `seed-mint:${colonyId}`,
        to: accountId,
        tokenId: 'metals.t1',
        amount: toCargoBaseUnits(200),
        caller: CARGO_MINTER_ACCOUNT,
      });

      const res = await importOutbox.handleCargoImported(
        makeCargoImportedEvent({
          planetId: 'pl_w10_import_happy',
          colonyId,
          colonyIndex: 0,
          importSeq: 1,
          resource: 'metals.t1',
          amount: 100,
        }),
      );
      expect(res).toEqual({ opId, accountId, status: 'PENDING' });

      const pendingTx = await db.prisma.cargoTx.findUniqueOrThrow({ where: { opId } });
      expect(pendingTx.direction).toBe('IMPORT');
      expect(pendingTx.state).toBe('PENDING');
      expect(pendingTx.amount.toFixed()).toBe(toCargoBaseUnits(100));

      const outboxBefore = await db.prisma.chainOutbox.findUniqueOrThrow({ where: { opId } });
      expect(outboxBefore.port).toBe('CargoToken');
      expect(outboxBefore.method).toBe('burn');
      expect(outboxBefore.status).toBe('PENDING');

      expect(await relayService.pollOnce()).toBe(1);

      const finalTx = await db.prisma.cargoTx.findUniqueOrThrow({ where: { opId } });
      expect(finalTx.state).toBe('FINAL');
      expect(finalTx.txHash).toMatch(MOCK_HASH_RE);
      expect(finalTx.lastError).toBeNull();

      const balanceAfter = await cargoToken.balanceOf({ accountId, tokenId: 'metals.t1' });
      expect(balanceAfter).toBe(toCargoBaseUnits(100));

      expect(settledEvents).toEqual([
        {
          planetId: 'pl_w10_import_happy',
          colonyId,
          colonyIndex: 0,
          ref: opId,
          opId,
          direction: 'import',
          resource: 'metals.t1',
          amount: 100,
          ok: true,
          txHash: finalTx.txHash ?? undefined,
        },
      ]);

      const settledCmd = submittedCmds.find(
        (c) => c.planetId === 'pl_w10_import_happy' && c.cmd.kind === 'cargo.settled',
      );
      expect(settledCmd).toBeDefined();
      verifySimSettlementCreditsStock(colonyId, settledCmd!.cmd);

      const settledEventIgnored = await importOutbox.handleCargoImported(
        makeCargoImportedEvent({ colonyId, importSeq: 1, amount: 100, phase: 'settled' }),
      );
      expect(settledEventIgnored).toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe('CargoImport insufficient_cargo rejection (W10-13)', () => {
  it('acceptance 2: importing 150 when only 100 is in orbit rejects with insufficient_cargo without burning tokens', async () => {
    const colonyId = newId('co');
    const accountId = defaultAccountForColony(colonyId);
    const opId = cargoImportOpId(colonyId, 1);
    const { settledEvents, submittedCmds, cleanup } = captureSettlement();

    try {
      await cargoToken.mint({
        opId: `seed-mint-low:${colonyId}`,
        to: accountId,
        tokenId: 'metals.t1',
        amount: toCargoBaseUnits(100),
        caller: CARGO_MINTER_ACCOUNT,
      });

      const res = await importOutbox.handleCargoImported(
        makeCargoImportedEvent({
          planetId: 'pl_w10_import_low',
          colonyId,
          colonyIndex: 1,
          importSeq: 1,
          resource: 'metals.t1',
          amount: 150,
        }),
      );
      expect(res).toEqual({
        opId,
        accountId,
        status: 'FAILED',
        error: 'insufficient_cargo',
      });

      const failedTx = await db.prisma.cargoTx.findUniqueOrThrow({ where: { opId } });
      expect(failedTx.direction).toBe('IMPORT');
      expect(failedTx.state).toBe('FAILED');
      expect(failedTx.lastError).toContain('insufficient_cargo');

      const outboxRow = await db.prisma.chainOutbox.findUnique({ where: { opId } });
      expect(outboxRow).toBeNull();

      const balanceAfter = await cargoToken.balanceOf({ accountId, tokenId: 'metals.t1' });
      expect(balanceAfter).toBe(toCargoBaseUnits(100));

      expect(settledEvents).toEqual([
        {
          planetId: 'pl_w10_import_low',
          colonyId,
          colonyIndex: 1,
          ref: opId,
          opId,
          direction: 'import',
          resource: 'metals.t1',
          amount: 150,
          ok: false,
          error: 'insufficient_cargo',
        },
      ]);

      const settledCmd = submittedCmds.find(
        (c) => c.planetId === 'pl_w10_import_low' && c.cmd.kind === 'cargo.settled',
      );
      expect(settledCmd).toBeDefined();
      expect(settledCmd!.cmd.args).toMatchObject({
        colonyId,
        ref: opId,
        direction: 'import',
        resource: 'metals.t1',
        amount: 150,
        ok: false,
        error: 'insufficient_cargo',
      });
    } finally {
      cleanup();
    }
  });
});
