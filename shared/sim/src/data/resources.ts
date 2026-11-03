import type { ResourceKey } from '@terra/contracts';
import opsBasic from './ops-basic';
import { defineTable } from './_define';

const fileYields = (id: string): Readonly<Partial<Record<ResourceKey, number>>> =>
  (opsBasic.rows.find((r) => r.id === id)?.yields ?? {}) as Readonly<Partial<Record<ResourceKey, number>>>;

/**
 * Reference table of resource incomes. `forest` / `rock` are NOT a second yield table: they mirror the file rows of
 * `opsBasic.clear` / `opsBasic.break` `yields` (THE terraform yield, untuned). Code that pays or shows a yield reads
 * `terraformYields` / `groundWorkYields` (`systems/terraform-basic/ops.ts`) with compiled data, so a `tune` applies.
 * @deprecated `forest` / `rock`: read `groundWorkYields(key, data)`.
 */
export const RESOURCE_INCOME_TABLE = {
  forest: fileYields('clear'),
  rock: fileYields('break'),
  'harvester.metals': { resourceId: 'metals.t1', ratePerSec: 1.875, cycleYield: 7.5, cycleSec: 4 },
  'harvester.minerals': { resourceId: 'minerals.t1', ratePerSec: 1.5, cycleYield: 6.0, cycleSec: 4 },
  'harvester.oil': { resourceId: 'bio.biomass', ratePerSec: 1.25, cycleYield: 5.0, cycleSec: 4 },
  'extractor.metals.t1': { resourceId: 'metals.t1', ratePerSec: 2.5 },
  'solar.t1': { resourceId: 'energy', ratePerSec: 20 },
  'command.hub': { resourceId: 'energy', ratePerSec: 8, waterRatePerSec: 0.5 },
} as const;

export type ResourceIncomeKey = keyof typeof RESOURCE_INCOME_TABLE;

/**
 * D-34 Resource families (`metals`, `minerals`, `bio`) and the 10 stored sub-resource stock keys (`ResourceKey`).
 * One storage cap per family is shared by its tiers (Hub T1 adds +500 per family). Energy is grid power (E/s), not stock.
 */
export default defineTable({
  name: 'resources',
  summary: 'D-34 resource catalog: one row per ResourceKey (10 stored sub-resources across Metals, Minerals, and Bio).',
  rows: [
    {
      id: 'metals.t1',
      wave: 'W02',
      family: 'metals',
      tier: 1,
      label: 'Iron',
      unlockedAtLanding: true,
      defaultHarvestWeight: 100,
    },
    {
      id: 'metals.t2',
      wave: 'W02',
      family: 'metals',
      tier: 2,
      label: 'Light Alloys',
      unlockedAtLanding: false,
      minTerraformPct: 30,
      ringRadius: 2,
      minRingTerraformedRatio: 0.5,
      yieldShare: 0.3,
    },
    {
      id: 'metals.t3',
      wave: 'W02',
      family: 'metals',
      tier: 3,
      label: 'Titanium',
      unlockedAtLanding: false,
      minTerraformPct: 70,
      ringRadius: 2,
      minRingLivingRatio: 0.5,
      yieldShare: 0.2,
    },
    {
      id: 'minerals.t1',
      wave: 'W02',
      family: 'minerals',
      tier: 1,
      label: 'Silica',
      unlockedAtLanding: true,
      defaultHarvestWeight: 100,
    },
    {
      id: 'minerals.t2',
      wave: 'W02',
      family: 'minerals',
      tier: 2,
      label: 'Rare Earths',
      unlockedAtLanding: false,
      minTerraformPct: 30,
      ringRadius: 2,
      minRingTerraformedRatio: 0.5,
      yieldShare: 0.3,
    },
    {
      id: 'minerals.t3',
      wave: 'W02',
      family: 'minerals',
      tier: 3,
      label: 'Exotic Crystal',
      unlockedAtLanding: false,
      minTerraformPct: 70,
      ringRadius: 2,
      minRingLivingRatio: 0.5,
      yieldShare: 0.2,
    },
    {
      id: 'bio.water',
      wave: 'W02',
      family: 'bio',
      tier: 1,
      label: 'Water',
      unlockedAtLanding: true,
      defaultHarvestWeight: 50,
    },
    {
      id: 'bio.biomass',
      wave: 'W02',
      family: 'bio',
      tier: 1,
      label: 'Biomass',
      unlockedAtLanding: true,
      defaultHarvestWeight: 100,
    },
    {
      id: 'bio.t2',
      wave: 'W02',
      family: 'bio',
      tier: 2,
      label: 'Petroleum',
      unlockedAtLanding: false,
      minTerraformPct: 30,
      ringRadius: 2,
      minRingTerraformedRatio: 0.5,
      yieldShare: 1.0,
    },
    {
      id: 'bio.t3',
      wave: 'W02',
      family: 'bio',
      tier: 3,
      label: 'Gene-stock',
      unlockedAtLanding: false,
      minTerraformPct: 70,
      ringRadius: 2,
      minRingLivingRatio: 0.5,
      yieldShare: 0.2,
    },
  ],
});
