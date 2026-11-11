import 'reflect-metadata';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MetricsRegistry } from '../../src/core/metrics.registry.js';
import type { AppEnv } from '../../src/core/tokens.js';
import type { FlagsService } from '../../src/flags/flags.service.js';
import { GuildFundingRepository } from '../../src/market/guild/funding/funding.repository.js';
import { GuildFundingService } from '../../src/market/guild/funding/guild-funding.service.js';
import { GuildNpcRepository } from '../../src/market/guild/guild-npc.repository.js';
import { GuildProvisionService } from '../../src/market/guild/guild-provision.service.js';
import { GuildTradeKeyBinder } from '../../src/market/guild/guild-trade-key.binder.js';
import { GuildWalletBinder } from '../../src/market/guild/guild-wallet.binder.js';
import { TradeKeyRepository } from '../../src/market/trade/trade-key.repository.js';
import { applyFill } from '../../src/market/guild/inventory.js';
import { GuildMetrics } from '../../src/market/guild/telemetry/guild-metrics.js';
import { MockAgentWalletAdapter } from '../../src/near/infrastructure/adapters/mock/agent-wallet.adapter.js';

const on = { has: (wave: string) => wave === 'W15' } as unknown as FlagsService;

let db: TestDatabase;
let npcs: GuildNpcRepository;
let funding: GuildFundingService;
let metrics: MetricsRegistry;

beforeAll(async () => {
  db = await createTestDatabase();
  const env = { NODE_ENV: 'test', DATABASE_URL: db.url } as AppEnv;
  const wallet = new MockAgentWalletAdapter(db.prisma, { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 15 }, { sleep: async () => undefined });
  npcs = new GuildNpcRepository(db.prisma);
  const provision = new GuildProvisionService(on, npcs, new GuildWalletBinder(wallet), new GuildTradeKeyBinder(db.prisma, new TradeKeyRepository(db.prisma)), env);
  await provision.provision();
  await provision.allocateFixtureCargo('kestrel', 'metals.t1', 1400);
  funding = new GuildFundingService(new GuildFundingRepository(db.prisma), on, env);
  await funding.read('kestrel');
  await funding.read('vanguard');
  metrics = new MetricsRegistry();
  new GuildMetrics(metrics, npcs, db.prisma);
});

afterAll(async () => {
  await db?.drop();
});

describe('guild metrics on Postgres (W15-27)', () => {
  it('scrapes kestrel metals at 1400, then 800 after a 600 sell', async () => {
    const before = await metrics.render();
    expect(before).toContain('guild_inventory{npc="kestrel",resource="metals.t1"} 1400');
    expect(before).toContain('guild_inventory{npc="vanguard",resource="metals.t1"} 0');
    expect(before).not.toContain('npc="nobody"');
    expect(before).toContain('guild_pnl_realized_atomic{npc="kestrel"} 0');
    expect(before).toContain('guild_reference_quality{npc="kestrel"} 0');
    const row = await npcs.find('kestrel');
    const cash = await db.prisma.guildFunding.findUniqueOrThrow({ where: { scope: 'kestrel' } });
    expect(before).toContain(`guild_cash_atomic{npc="kestrel"} ${String(Number(cash.cashCapAtomic.toFixed(0)))}`);
    expect(before).toContain(`guild_subsidy_allocation_atomic{npc="kestrel",allocation="${row!.allocationId}"} ${String(Number(row!.quoteBudgetAtomic))}`);

    const filled = applyFill(row!, { resource: 'metals.t1', side: 'sell', amount: 600, planetId: 'pl_metrics' });
    expect(filled.ok).toBe(true);
    if (!filled.ok) return;
    await npcs.saveInventory('kestrel', filled.inventory);
    await db.prisma.guildNpc.update({ where: { id: 'kestrel' }, data: { lossAtomic: '40' } });
    await funding.reserve('kestrel', 'inventory', 25n);

    const after = await metrics.render();
    expect(after).toContain('guild_inventory{npc="kestrel",resource="metals.t1"} 800');
    expect(after).not.toContain('guild_inventory{npc="kestrel",resource="metals.t1"} 1400');
    expect(after).toContain('guild_pnl_realized_atomic{npc="kestrel"} -40');
    expect(after).toContain('guild_pnl_conservative_atomic{npc="kestrel"} -40');
    expect(after).toContain('guild_exposure_outstanding_atomic{npc="kestrel",bucket="inventory"} 25');
    expect(after).toContain('guild_exposure_outstanding_atomic{npc="global",bucket="inventory"} 25');
  });
});
