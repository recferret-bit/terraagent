import { compileData, dataRow, type CompiledRow } from '../../data';
import type { CompiledDataLike } from '../../kernel/config';
import { resolveProducedWorkerRow, workerTierOf } from '../harvest/unit';

let cachedData: CompiledDataLike | null = null;

/** W00–W05 defaults for Hub production and supply when a caller passes no compiled data. */
export function defaultHubData(): CompiledDataLike {
  if (!cachedData) cachedData = compileData(new Set(['W00', 'W01', 'W02', 'W03', 'W05']));
  return cachedData;
}

export function resolveHubProducerRows(data?: CompiledDataLike): { hubProd: CompiledRow; hub: CompiledRow } {
  const d = data?.tables?.unitsWorkersBasic ? data : defaultHubData();
  return {
    hubProd: dataRow(d, 'unitsWorkersBasic', 'hubProduction'),
    hub: dataRow(d, 'hub', 't1'),
  };
}

/**
 * Balance row for a Hub unit order. Only `worker` is producible here; `tier` 1, 2, or 3 (missing means 1).
 * A tier whose wave is off in `data` is `null`.
 */
export function resolveUnitRowForHub(unit: string, data?: CompiledDataLike, tier?: number): CompiledRow | null {
  if (unit !== 'worker') return null;
  if (tier !== undefined && tier !== 1 && tier !== 2 && tier !== 3) return null;
  return resolveProducedWorkerRow(data, workerTierOf(tier));
}
