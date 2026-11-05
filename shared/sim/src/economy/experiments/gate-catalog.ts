import type { GateDef } from './gates';

/**
 * Versioned gate definitions (ECONOMY §7, D-35: the numbers are data). `hard` gates are invariants every run must meet and
 * are evaluated by code (`hardGates` in gates.ts); they are listed so a report names the version it used. `economic` gates
 * read the last sampled window of a metric; every threshold is a CALIBRATION HYPOTHESIS (`approved: false`), never a
 * measured fact. A catalog change is a new `gateVersion`, never an edit of a published one.
 */
export interface CatalogGate extends GateDef {
  readonly kind: 'hard' | 'economic';
  readonly description: string;
  /** False until the pilot record approves the threshold; an unapproved gate can never support `cashApproval`. */
  readonly approved: boolean;
}

const HARD = (gateId: string, description: string): CatalogGate => ({
  gateId, gateVersion: 1, kind: 'hard', description, metricKey: '-', scope: 'run', aggregate: 'last', op: 'lte', threshold: '0', approved: true,
});

export const HARD_GATES: readonly CatalogGate[] = [
  HARD('hard.flow_reconciliation', 'closing stock equals the flow identity for every resource (exact)'),
  HARD('hard.no_negative_stock', 'no colony stock is negative at any step'),
  HARD('hard.mock_ledger_conservation', 'the mock ledger holds exactly what the faucet put in'),
];

const ECON = (gateId: string, description: string, metricKey: string, op: 'gte' | 'lte', threshold: string, resource?: string): CatalogGate => ({
  gateId, gateVersion: 1, kind: 'economic', description, metricKey, scope: 'global', ...(resource ? { resource } : {}), aggregate: 'last', op, threshold, approved: false,
});

export const ECONOMIC_GATES: readonly CatalogGate[] = [
  ECON('econ.trade_depth.volume_water', 'water changes hands in the last window', 'market.volume', 'gte', '1', 'bio.water'),
  ECON('econ.inventory.position_water', 'global water position stays positive', 'inventory.position', 'gte', '1', 'bio.water'),
  ECON('econ.inventory.position_metals', 'global metals T1 position stays positive', 'inventory.position', 'gte', '1', 'metals.t1'),
  ECON('econ.fill_ratio.floor', 'at least 5 trades per 100 orders placed in the last window', 'market.fill_ratio', 'gte', '0.05'),
];

export const GATE_CATALOG: readonly CatalogGate[] = [...HARD_GATES, ...ECONOMIC_GATES];
