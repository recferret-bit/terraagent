/**
 * The comparison dimensions of ECONOMY §6 (Pareto, never one scalar) and the metrics that measure each. A metric
 * missing from a run makes its dimension `insufficient_data`, never zero. `revenue` marks platform contribution: it can
 * never be the only reason to recommend a candidate. Data, versioned with the catalog.
 */
export type Polarity = 'higher' | 'lower';
export interface DimensionMetric { readonly metricKey: string; readonly polarity: Polarity }
export interface Dimension { readonly id: string; readonly revenue: boolean; readonly metrics: readonly DimensionMetric[] }

export const DIMENSION_CATALOG_VERSION = 1;

export const DIMENSIONS: readonly Dimension[] = [
  { id: 'retention', revenue: false, metrics: [{ metricKey: 'days_of_inventory', polarity: 'higher' }] },
  { id: 'progression', revenue: false, metrics: [{ metricKey: 'flow.production', polarity: 'higher' }] },
  { id: 'affordability', revenue: false, metrics: [{ metricKey: 'market.price.vwap', polarity: 'lower' }] },
  { id: 'tradingDepth', revenue: false, metrics: [{ metricKey: 'market.volume', polarity: 'higher' }, { metricKey: 'market.fill_ratio', polarity: 'higher' }] },
  { id: 'inventoryGrowth', revenue: false, metrics: [{ metricKey: 'inventory.position', polarity: 'higher' }] },
  { id: 'netContribution', revenue: true, metrics: [{ metricKey: 'market.fee.platform', polarity: 'higher' }, { metricKey: 'market.fee.stall', polarity: 'higher' }] },
];
