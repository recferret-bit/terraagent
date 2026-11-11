import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { Counter, type Registry } from 'prom-client';
import { MetricsRegistry } from '../../../core/metrics.registry.js';
import { scrapeGauge } from '../../../core/scrape-gauge.js';
import { PRISMA } from '../../../db/db.module.js';
import { GuildNpcRepository } from '../guild-npc.repository.js';
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
  guildGaugeSamples,
  isQuoteRejectReason,
  type FundingMetricSource,
  type GuildGaugeSample,
  type NpcMetricSource,
} from './samples.js';

const GAUGES: readonly { name: string; help: string; labelNames: readonly string[] }[] = [
  { name: GUILD_INVENTORY, help: 'Guild NPC cargo in whole units, from chain.guild_npc.inventory_cache. A Tier-1 resource with no line is 0.', labelNames: ['npc', 'resource'] },
  { name: GUILD_CASH, help: 'Available Guild cash in atomic units (cap - reserved - spent). Without a funding row, the npc quote budget. npc=global is the guild-wide book.', labelNames: ['npc'] },
  { name: GUILD_PNL_REALIZED, help: 'Realized Guild PnL in atomic units: minus chain.guild_npc.loss_atomic. Inventory is not included.', labelNames: ['npc'] },
  { name: GUILD_PNL_CONSERVATIVE, help: 'Realized PnL with inventory marked at 0. These rows store no price, so unrealized inventory is not added.', labelNames: ['npc'] },
  { name: GUILD_EXPOSURE, help: 'Open Guild exposure. bucket=cash is cash_reserved_atomic; bucket=inventory is inventory_reserved. npc=global is the guild-wide book.', labelNames: ['npc', 'bucket'] },
  { name: GUILD_SUBSIDY, help: 'Explicit subsidy allocation in atomic units (quote_budget_atomic). Not reduced by spend.', labelNames: ['npc', 'allocation'] },
  { name: GUILD_REFERENCE, help: '1 when these rows record a fresh eligible reference; 0 when they do not.', labelNames: ['npc'] },
];

/**
 * W15-27 guild gauges on the shared registry. Each scrape reads `guild_npc` and `guild_funding`.
 * A database error leaves that gauge empty and does not fail `/v1/metrics`.
 * `reject` counts maker pauses. That counter resets on process restart.
 */
@Injectable()
export class GuildMetrics {
  private readonly rejected: Counter<'reason'>;
  private pending: Promise<GuildGaugeSample[]> | null = null;

  constructor(
    metrics: MetricsRegistry,
    private readonly npcs: GuildNpcRepository,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {
    this.rejected = registerRejected(metrics.registry);
    registerGauges(metrics.registry, () => this.load());
  }

  /** Count a maker pause. Any other reason is ignored. */
  reject(reason: string): void {
    noteQuoteRejected(this.rejected, reason);
  }

  private load(): Promise<GuildGaugeSample[]> {
    if (this.pending) return this.pending;
    const run = this.read().finally(() => {
      if (this.pending === run) this.pending = null;
    });
    this.pending = run;
    return run;
  }

  private async read(): Promise<GuildGaugeSample[]> {
    const [npcs, funding] = await Promise.all([this.npcs.list(), this.prisma.guildFunding.findMany()]);
    return guildGaugeSamples(npcs.map(npcSource), funding.map(fundingSource));
  }
}

/** Increment only `funding_cap`, `killed`, `cash_paused`, or `inventory_short`. */
export function noteQuoteRejected(counter: Counter<'reason'> | undefined, reason: string): void {
  if (!counter || !isQuoteRejectReason(reason)) return;
  counter.inc({ reason });
}

function registerRejected(registry: Registry): Counter<'reason'> {
  const existing = registry.getSingleMetric(GUILD_QUOTE_REJECTED) as Counter<'reason'> | undefined;
  if (existing) return existing;
  const counter = new Counter({
    name: GUILD_QUOTE_REJECTED,
    help: 'Guild quotes the maker skipped, by reason: funding_cap, killed, cash_paused, inventory_short. Resets on process restart.',
    labelNames: ['reason'],
    registers: [registry],
  });
  for (const reason of QUOTE_REJECT_REASONS) counter.inc({ reason }, 0);
  return counter;
}

function registerGauges(registry: Registry, load: () => Promise<GuildGaugeSample[]>): void {
  for (const def of GAUGES) {
    if (registry.getSingleMetric(def.name)) continue;
    scrapeGauge(registry, def, async (set) => {
      for (const row of await load()) {
        if (row.name !== def.name) continue;
        set({ ...row.labels }, row.value);
      }
    });
  }
}

function npcSource(row: {
  npcId: string;
  inventory: NpcMetricSource['inventory'];
  quoteBudgetAtomic: string;
  spendAtomic: string;
  lossAtomic: string;
  allocationId: string;
  quoteLabel: string;
}): NpcMetricSource {
  return {
    npcId: row.npcId,
    inventory: row.inventory,
    quoteBudgetAtomic: row.quoteBudgetAtomic,
    spendAtomic: row.spendAtomic,
    lossAtomic: row.lossAtomic,
    allocationId: row.allocationId,
    quoteLabel: row.quoteLabel,
  };
}

function fundingSource(row: {
  scope: string;
  cashCapAtomic: { toFixed(digits: number): string };
  cashReservedAtomic: { toFixed(digits: number): string };
  cashSpentAtomic: { toFixed(digits: number): string };
  inventoryReserved: { toFixed(digits: number): string };
}): FundingMetricSource {
  return {
    scope: row.scope,
    cashCapAtomic: row.cashCapAtomic.toFixed(0),
    cashReservedAtomic: row.cashReservedAtomic.toFixed(0),
    cashSpentAtomic: row.cashSpentAtomic.toFixed(0),
    inventoryReserved: row.inventoryReserved.toFixed(0),
  };
}
