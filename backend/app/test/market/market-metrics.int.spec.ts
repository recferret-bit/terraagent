import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { MARKET_TOKENS, marketOrderRef, toChainUnits } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import type { PlanetEventOf } from '../../src/bus/channels.js';
import { EventBus } from '../../src/bus/event-bus.js';
import { PlaceOrderService } from '../../src/market/orders/place-order.service.js';
import { MetricsRegistry } from '../../src/core/metrics.registry.js';
import { OutboxRelayService } from '../../src/near/application/outbox/outbox.module.js';
import { IntentsPort } from '../../src/near/application/ports/intents.port.js';
import type { NearMarketCommandBusEvent } from '../../src/market/orders/market-sim-gateway.js';
import type { MockIntentsAdapter } from '../../src/near/infrastructure/adapters/mock/intents.adapter.js';
import { mockChainControls } from '../../src/near/infrastructure/mock/mock-controls.js';

let db: TestDatabase;
let app: INestApplication;
let place: PlaceOrderService;
let relay: OutboxRelayService;
let intents: MockIntentsAdapter;
let bus: EventBus;
const cmds: NearMarketCommandBusEvent[] = [];

const WATER = MARKET_TOKENS['bio.water'].verifierId;
const USDC = MARKET_TOKENS.USDC.verifierId;
const acct = (c: string) => `${c}.terraagent.mock`;
let planetN = 0;
let seq = 0;

beforeAll(async () => {
  db = await createTestDatabase();
  const created = await createApp({
    source: { NODE_ENV: 'test', LOG_LEVEL: 'silent', SIM_THREADS: '1', SNAPSHOTS: 'off', DATABASE_URL: db.url, OUTBOX_RELAY_ENABLED: 'false', MOCK_LATENCY_MIN_MS: '0', MOCK_LATENCY_MAX_MS: '0' },
  });
  app = created.app;
  await app.init();
  place = app.get(PlaceOrderService);
  relay = app.get(OutboxRelayService);
  intents = app.get(IntentsPort, { strict: false }) as unknown as MockIntentsAdapter;
  bus = app.get(EventBus);
  bus.on('near.market.command', (c) => cmds.push(c), { module: 'test' });
  await intents.testRegisterSigner('platform.terraagent.mock');
});
afterEach(() => mockChainControls.reset());
afterAll(async () => {
  await app?.close();
  await db?.drop();
});


const requested = (planetId: string, colony: string, over: Record<string, unknown>): PlanetEventOf<'marketOrderRequested'> => {
  const orderSeq = ++seq;
  return {
    planetId, tick: 1, kind: 'marketOrderRequested', severity: 'info', colonyIds: [colony],
    data: { ref: marketOrderRef(colony, orderSeq), orderSeq, colonyId: colony, colonyIndex: colony.startsWith('s') ? 0 : 1, resource: 'bio.water', amount: 300, ttlS: 3600, stallFeeBp: 100, hubEntityId: 3, ...over },
  } as unknown as PlanetEventOf<'marketOrderRequested'>;
};

/** A player ask and a player bid on `planetId` that fill each other (maker = seller). */
async function playerTrade(planetId: string) {
  const n = ++planetN;
  const [seller, buyer] = [`s${n}`, `b${n}`];
  for (const c of [seller, buyer]) await intents.testRegisterSigner(acct(c));
  await intents.testSeedVerifier(acct(seller), WATER, toChainUnits('bio.water', 300n));
  await intents.testSeedVerifier(acct(buyer), USDC, 10_000_000n);
  await place.handle(requested(planetId, seller, { side: 'sell', price: { token: 'USDC', amount: '5000000' } }));
  await place.handle(requested(planetId, buyer, { side: 'buy', price: { token: 'USDC', amount: '5000000' }, maxStallFeeBp: 100 }));
}

describe('W13-29 market telemetry', () => {
  it('two FINAL player trades show market_trades_total{maker_kind="player"} 2, fees and an open order', async () => {
    const planetId = 'pmetrics';
    await playerTrade(planetId);
    await playerTrade(planetId);
    await relay.pollOnce();
    await relay.pollOnce();
    const n = ++planetN;
    await intents.testRegisterSigner(acct(`s${n}`));
    await intents.testSeedVerifier(acct(`s${n}`), WATER, toChainUnits('bio.water', 300n));
    await place.handle(requested(planetId, `s${n}`, { side: 'sell', price: { token: 'USDC', amount: '9000000' } }));

    const text = await app.get(MetricsRegistry).render();
    expect(text).toContain(`market_trades_total{planet="${planetId}",maker_kind="player"} 2`);
    expect(text).toContain(`market_fees_total{planet="${planetId}",token="USDC",kind="stall"} 100000`);
    // Gross platform fee is 100000. W22 records 80000 on platform and 20000 on treasury.
    expect(text).toContain(`market_fees_total{planet="${planetId}",token="USDC",kind="platform"} 80000`);
    expect(text).toContain(`market_fees_total{planet="${planetId}",token="USDC",kind="treasury"} 20000`);
    expect(text).toContain(`market_orders_open{planet="${planetId}"} 1`);
    expect(text).toContain(`market_reserved_principal{planet="${planetId}",token="bio.water"} 300`);
    expect(text).toMatch(/ta_economy_profile_info\{profile_hash="[^"]+",data_hash="[^"]+"\} 1/);
    expect(text).toContain('# TYPE intent_batch_failed_total counter');
  });
});
