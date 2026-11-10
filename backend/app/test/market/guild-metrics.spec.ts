import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@terra/db';
import { MetricsRegistry } from '../../src/core/metrics.registry.js';
import type { GuildNpcRepository } from '../../src/market/guild/guild-npc.repository.js';
import { emptyInventory, withCargo, type InventoryCache } from '../../src/market/guild/guild-plan.js';
import { applyFill } from '../../src/market/guild/inventory.js';
import { GuildMetrics, noteQuoteRejected } from '../../src/market/guild/telemetry/guild-metrics.js';
import {
  GUILD_CASH,
  GUILD_EXPOSURE,
  GUILD_INVENTORY,
  GUILD_PNL_CONSERVATIVE,
  GUILD_PNL_REALIZED,
  GUILD_QUOTE_REJECTED,
  GUILD_REFERENCE,
  GUILD_SUBSIDY,
  QUOTE_REJECT_REASONS,
  atomicNumber,
  gaugeValue,
  guildGaugeSamples,
  isQuoteRejectReason,
  type FundingMetricSource,
  type NpcMetricSource,
} from '../../src/market/guild/telemetry/samples.js';

const dec = (n: string) => ({ toFixed: () => n });

describe('guild gauge samples (W15-27)', () => {
  it('positive: metals 1400 is 1400, and a -600 fill is 800', () => {
    const before = withCargo(emptyInventory(), 'metals.t1', 1400);
    expect(metals(guildGaugeSamples([npc('kestrel', before)]))).toBe(1400);
    const filled = applyFill({ inventory: before }, { resource: 'metals.t1', side: 'sell', amount: 600, planetId: 'p' });
    expect(filled.ok).toBe(true);
    if (!filled.ok) return;
    expect(metals(guildGaugeSamples([npc('kestrel', filled.inventory)]))).toBe(800);
  });

  it('negative: an empty cache is 0 and an unknown npc is absent', () => {
    const samples = guildGaugeSamples([npc('kestrel', emptyInventory())]);
    expect(metals(samples)).toBe(0);
    expect(gaugeValue(samples, GUILD_INVENTORY, { npc: 'kestrel', resource: 'bio.water' })).toBe(0);
    expect(gaugeValue(samples, GUILD_CASH, { npc: 'kestrel' })).toBe(50);
    expect(metals(samples, 'vanguard')).toBeUndefined();
    expect(samples.some((row) => row.labels.npc === 'nobody')).toBe(false);
  });

  it('negative: a fractional line is 0, a non-subsidy row has no allocation, and a bad loss is 0', () => {
    const cache: InventoryCache = {
      label: 'fixture', organic: false,
      lines: [{ resource: 'metals.t1', amount: 1.5, label: 'fixture', organic: false, source: 'mock-grant' }],
    };
    const samples = guildGaugeSamples([npc('kestrel', cache, { quoteLabel: 'fixture', lossAtomic: 'nope', spendAtomic: '9' })]);
    expect(metals(samples)).toBe(0);
    expect(gaugeValue(samples, GUILD_SUBSIDY, { npc: 'kestrel', allocation: 'guild-alloc:test:kestrel' })).toBeUndefined();
    expect(gaugeValue(samples, GUILD_PNL_REALIZED, { npc: 'kestrel' })).toBe(0);
    expect(gaugeValue(samples, GUILD_PNL_CONSERVATIVE, { npc: 'kestrel' })).toBe(0);
  });

  it('corner: summed lines, free cash, reserved exposure, and conservative PnL equal realized', () => {
    const cache = withCargo(withCargo(emptyInventory(), 'metals.t1', 1000), 'metals.t1', 400);
    const samples = guildGaugeSamples(
      [npc('kestrel', cache, { lossAtomic: '40', quoteBudgetAtomic: '50' })],
      [book('kestrel', { cashCapAtomic: '100', cashReservedAtomic: '30', cashSpentAtomic: '10', inventoryReserved: '4' }), book('global', { cashCapAtomic: '9' })],
    );
    expect(metals(samples)).toBe(1400);
    expect(gaugeValue(samples, GUILD_CASH, { npc: 'kestrel' })).toBe(60);
    expect(gaugeValue(samples, GUILD_CASH, { npc: 'global' })).toBe(9);
    expect(gaugeValue(samples, GUILD_EXPOSURE, { npc: 'kestrel', bucket: 'cash' })).toBe(30);
    expect(gaugeValue(samples, GUILD_EXPOSURE, { npc: 'kestrel', bucket: 'inventory' })).toBe(4);
    expect(gaugeValue(samples, GUILD_EXPOSURE, { npc: 'global', bucket: 'inventory' })).toBe(0);
    expect(gaugeValue(samples, GUILD_PNL_REALIZED, { npc: 'kestrel' })).toBe(-40);
    expect(gaugeValue(samples, GUILD_PNL_CONSERVATIVE, { npc: 'kestrel' })).toBe(-40);
    expect(gaugeValue(samples, GUILD_SUBSIDY, { npc: 'kestrel', allocation: 'guild-alloc:test:kestrel' })).toBe(50);
    expect(gaugeValue(samples, GUILD_REFERENCE, { npc: 'kestrel' })).toBe(0);
    expect(gaugeValue(samples, GUILD_INVENTORY, { npc: 'global', resource: 'metals.t1' })).toBeUndefined();
  });

  it('corner: cash reserved above the cap clamps at 0, and only the four pause reasons count', () => {
    const samples = guildGaugeSamples([npc('kestrel', emptyInventory())], [book('kestrel', { cashCapAtomic: '10', cashReservedAtomic: '40' })]);
    expect(gaugeValue(samples, GUILD_CASH, { npc: 'kestrel' })).toBe(0);
    expect(atomicNumber('nope')).toBe(0);
    expect(QUOTE_REJECT_REASONS.every(isQuoteRejectReason)).toBe(true);
    expect(isQuoteRejectReason('paused')).toBe(false);
    expect(isQuoteRejectReason('loss')).toBe(false);
  });
});

describe('GuildMetrics scrape (W15-27)', () => {
  it('positive: a later read replaces 1400 with 800, and one scrape hits the tables once', async () => {
    let stock = 1400;
    let reads = 0;
    const metrics = new MetricsRegistry();
    const gauge = new GuildMetrics(metrics, repo(() => {
      reads += 1;
      return [npc('kestrel', withCargo(emptyInventory(), 'metals.t1', stock))];
    }), fundingClient([], () => { reads += 1; }));
    expect(await metrics.render()).toContain('guild_inventory{npc="kestrel",resource="metals.t1"} 1400');
    expect(reads).toBe(2);
    stock = 800;
    expect(await metrics.render()).toContain('guild_inventory{npc="kestrel",resource="metals.t1"} 800');
    expect(reads).toBe(4);
    gauge.reject('funding_cap');
    gauge.reject('paused');
    const text = await metrics.render();
    expect(text).toContain(`${GUILD_QUOTE_REJECTED}{reason="funding_cap"} 1`);
    expect(text).toContain(`${GUILD_QUOTE_REJECTED}{reason="killed"} 0`);
    expect(text).not.toContain('reason="paused"');
  });

  it('negative: a failed read leaves the gauge empty and does not fail the scrape', async () => {
    const metrics = new MetricsRegistry();
    new GuildMetrics(metrics, repo(() => { throw new Error('down'); }), fundingClient([]));
    const text = await metrics.render();
    expect(text).toContain('# TYPE guild_inventory gauge');
    expect(text).not.toContain('npc="kestrel"');
  });

  it('corner: noteQuoteRejected ignores an unknown reason', () => {
    const metrics = new MetricsRegistry();
    const gauge = new GuildMetrics(metrics, repo(() => []), fundingClient([]));
    noteQuoteRejected(undefined, 'funding_cap');
    gauge.reject('cash_paused');
    gauge.reject('killed');
    return metrics.render().then((text) => {
      expect(text).toContain(`${GUILD_QUOTE_REJECTED}{reason="cash_paused"} 1`);
      expect(text).toContain(`${GUILD_QUOTE_REJECTED}{reason="killed"} 1`);
      expect(text).toContain(`${GUILD_QUOTE_REJECTED}{reason="inventory_short"} 0`);
    });
  });
});

function npc(id: string, inventory: InventoryCache, over: Partial<NpcMetricSource> = {}): NpcMetricSource {
  return {
    npcId: id,
    inventory,
    quoteBudgetAtomic: '50',
    spendAtomic: '0',
    lossAtomic: '0',
    allocationId: `guild-alloc:test:${id}`,
    quoteLabel: 'subsidy',
    ...over,
  };
}

function book(scope: string, over: Partial<FundingMetricSource> = {}): FundingMetricSource {
  return { scope, cashCapAtomic: '0', cashReservedAtomic: '0', cashSpentAtomic: '0', inventoryReserved: '0', ...over };
}

function metals(samples: ReturnType<typeof guildGaugeSamples>, who = 'kestrel'): number | undefined {
  return gaugeValue(samples, GUILD_INVENTORY, { npc: who, resource: 'metals.t1' });
}

function repo(list: () => NpcMetricSource[]): GuildNpcRepository {
  return { list } as unknown as GuildNpcRepository;
}

function fundingClient(rows: FundingMetricSource[], onRead?: () => void): PrismaClient {
  return {
    guildFunding: {
      findMany: async () => {
        onRead?.();
        return rows.map((row) => ({
          scope: row.scope,
          cashCapAtomic: dec(row.cashCapAtomic),
          cashReservedAtomic: dec(row.cashReservedAtomic),
          cashSpentAtomic: dec(row.cashSpentAtomic),
          inventoryReserved: dec(row.inventoryReserved),
        }));
      },
    },
  } as unknown as PrismaClient;
}
