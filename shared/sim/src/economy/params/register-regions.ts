import { RESOURCE_KEYS } from '@terra/contracts';
import logistics from '../../data/logistics';
import regions from '../../data/regions';
import { registerField, type FieldSpec } from './fields';
import type { ParamRegistry } from './registry';

const NEW_WORLD = 'endowment is pinned to the world manifest at first creation (ECON-GEO-02); changing it needs a value-preserving migration';
const MAP = { type: 'intMap' as const, mapKeys: RESOURCE_KEYS };

/**
 * `regions.defaults` (the GLOBAL layer of the endowment resolution order) and `logistics.coefficients` (W13-50).
 * Endowment fields are `new_world_only`; yields, renewal and the logistics coefficients are `runtime`. Defaults come from the
 * data tables and are calibration fixtures (ECONOMY §2.2/§2.3), not live economics.
 */
export function registerRegionParams(r: ParamRegistry): void {
  const nw = (description: string, spec: Omit<FieldSpec, 'description' | 'mutability' | 'why'>): FieldSpec => ({ description, ...spec, mutability: 'new_world_only', why: NEW_WORLD });
  registerField(r, regions, 'defaults', 'depositDensityPer1000Tiles', nw('Deposits per 1000 tiles of a sector, set once per sector profile.', { unit: 'count', type: 'int', bounds: { min: 0, max: 1000 } }));
  registerField(r, regions, 'defaults', 'occurrenceWeightBp', nw('Relative probability weight among eligible deposits per resource (global layer); all-zero eligible sets make no optional deposits.', { ...MAP, unit: 'bp', bounds: { min: 0, max: 1_000_000 } }));
  registerField(r, regions, 'defaults', 'reserveUnitsMin', nw('Smallest finite deposit per resource, whole units.', { ...MAP, unit: 'whole_units', bounds: { min: 0, max: 1_000_000_000 } }));
  registerField(r, regions, 'defaults', 'reserveUnitsMax', nw('Largest finite deposit per resource, whole units (>= min).', { ...MAP, unit: 'whole_units', bounds: { min: 0, max: 1_000_000_000 } }));
  registerField(r, regions, 'defaults', 'terraformFindWeightBp', nw('Terraform discovery weight per resource (no scarcity bypass).', { ...MAP, unit: 'bp', bounds: { min: 0, max: 1_000_000 } }));
  registerField(r, regions, 'defaults', 'starterGuarantee', nw('Bounded starter reserve per resource, whole units (essential T1 access: water, metals, minerals).', { ...MAP, unit: 'whole_units', bounds: { min: 0, max: 1_000_000_000 } }));
  registerField(r, regions, 'defaults', 'extractionYieldBp', { description: 'Output per work unit per resource (affects finite reserves and credited output consistently).', ...MAP, unit: 'bp', bounds: { min: 0, max: 1_000_000 }, mutability: 'runtime' });
  registerField(r, regions, 'defaults', 'renewableUnitsPerSimHour', { description: 'Sector-total renewable allowance per sim hour per resource; 0 means no renewal.', ...MAP, unit: 'whole_units', bounds: { min: 0, max: 1_000_000_000 }, mutability: 'runtime' });

  const rt = (field: string, description: string, unit: FieldSpec['unit'], max: number, min = 0): void =>
    registerField(r, logistics, 'coefficients', field, { description, unit, type: 'int', bounds: { min, max }, mutability: 'runtime' });
  rt('alphaBp', 'Congestion coefficient alpha (10000 = 1.0).', 'bp', 100000);
  rt('maxMultiplierBp', 'Maximum congestion multiplier (10000 = 1.0).', 'bp', 100000, 10000);
  rt('betaBp', 'Distance coefficient beta (10000 = 1.0).', 'bp', 100000);
  rt('referenceRouteTiles', 'Reference route length in tiles.', 'count', 10000, 1);
  rt('maxDistanceRatioBp', 'Maximum route/reference ratio counted in the distance factor (10000 = 1.0).', 'bp', 1000000, 10000);
  rt('readinessReserveBp', 'Readiness factor of reserve units.', 'bp', 10000);
  rt('readinessReadyBp', 'Readiness factor of ready/garrison units.', 'bp', 10000);
  rt('readinessMovingBp', 'Readiness factor of moving units.', 'bp', 10000);
  rt('readinessCombatBp', 'Readiness factor of units in combat.', 'bp', 10000);
  rt('minCombatServiceBp', 'Minimum combat service fraction (attack cadence floor).', 'ratio_bp', 10000);
  registerField(r, logistics, 'node.*', 'throughputPerWindow', { description: 'Logistics throughput a supply node provides per window, by tier (load units).', unit: 'count', type: 'int', bounds: { min: 0, max: 1_000_000 }, mutability: 'runtime' });
  registerField(r, logistics, 'node.*', 'reachTiles', { description: 'Service reach of a supply node in route tiles, by tier.', unit: 'count', type: 'int', bounds: { min: 0, max: 100_000 }, mutability: 'runtime' });
  rt('graceWindows', 'Supply windows of local reserve before throughput scales by delivered service.', 'count', 1000);
}
