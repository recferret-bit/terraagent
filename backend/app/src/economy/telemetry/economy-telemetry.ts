import { Injectable } from '@nestjs/common';
import { RESOURCE_KEYS } from '@terra/contracts';
import { colonyIndexOfAccount } from '@terra/sim/economy/accounts';
import { accountFlows, grossConsumption, totalCapped, totalProduction } from '@terra/sim/economy/flows/accounting';
import { Counter } from 'prom-client';
import { MetricsRegistry } from '../../core/metrics.registry.js';
import { scrapeGauge } from '../../core/scrape-gauge.js';
import { GamePlanets } from '../../game/game-planets.service.js';
import { PlanetLedgerService } from '../../game/ledger/planet-ledger.service.js';
import { EconomyProfileService } from '../profile/profile.service.js';

const ALL_TIME = { startTick: -1, endTick: Number.MAX_SAFE_INTEGER } as const;

/**
 * W13-29 economy telemetry. Every ledger batch of every planet goes through the W13-42 `accountFlows` once and adds to
 * `ta_economy_flow_total{planet,resource,flow}` (whole resource units, global scope: transfers cancel; `capped` is output lost to
 * the storage cap and is NOT in `production`). Inventories (`ta_economy_inventory`, whole units over colony accounts) are read
 * from the planet journal at scrape time, so nothing needs a timer. `ta_economy_profile_info` carries the active global profile
 * hash and the data hash it compiles to (info gauge, value 1).
 */
@Injectable()
export class EconomyTelemetry {
  private readonly flows: Counter<'planet' | 'resource' | 'flow'>;
  private readonly loaded = new Set<string>();

  constructor(
    planets: GamePlanets,
    private readonly ledger: PlanetLedgerService,
    private readonly profiles: EconomyProfileService,
    metrics: MetricsRegistry,
  ) {
    const registers = [metrics.registry];
    this.flows = new Counter({ name: 'ta_economy_flow_total', help: 'Resource flows since boot in whole units: flow = production|capped|consumption|imports|exports (consumption is gross)', labelNames: ['planet', 'resource', 'flow'], registers });
    scrapeGauge(metrics.registry, { name: 'ta_economy_inventory', help: 'Resource inventory in whole units: sum of colony ledger accounts of a loaded planet', labelNames: ['planet', 'resource'] }, (set) => {
      for (const [planet, resource, v] of this.inventories()) set({ planet, resource }, v);
    });
    scrapeGauge(metrics.registry, { name: 'ta_economy_profile_info', help: 'Info: active global economy profile hash and the data hash it compiles to (value 1)', labelNames: ['profile_hash', 'data_hash'] }, async (set) => {
      const h = await this.hashes();
      set({ profile_hash: h.profile, data_hash: h.data }, 1);
    });
    planets.onPlanetLedger((id, _tick, postings) => this.record(id, postings));
    planets.onPlanetLoaded((id) => { this.loaded.add(id); });
    planets.onPlanetUnloaded((id) => { this.loaded.delete(id); });
  }

  private record(planetId: string, postings: Parameters<typeof accountFlows>[0]): void {
    if (postings.length === 0) return;
    try {
      const { global } = accountFlows(postings, ALL_TIME, 'position');
      for (const resource of RESOURCE_KEYS) {
        const f = global[resource];
        for (const [flow, v] of [['production', totalProduction(f)], ['capped', totalCapped(f)], ['consumption', grossConsumption(f)], ['imports', f.imports], ['exports', f.exports]] as const) {
          if (v > 0n) this.flows.inc({ planet: planetId, resource, flow }, Number(v));
        }
      }
    } catch { /* telemetry never affects the sim */ }
  }

  private *inventories(): Generator<[string, string, number]> {
    for (const planet of this.loaded) {
      const journal = this.ledger.journalOf(planet);
      if (!journal) continue;
      const sums = new Map<string, number>();
      for (const account of journal.accounts()) {
        if (colonyIndexOfAccount(account) < 0) continue;
        for (const [asset, n] of Object.entries(journal.balances(account))) sums.set(asset, (sums.get(asset) ?? 0) + n);
      }
      for (const resource of RESOURCE_KEYS) yield [planet, resource, sums.get(resource) ?? 0];
    }
  }

  private async hashes(): Promise<{ profile: string; data: string }> {
    try { const c = await this.profiles.compiledFor({}); return { profile: c.overridesHash, data: c.dataHash }; } catch { return { profile: 'unavailable', data: 'unavailable' }; }
  }
}
