import { defaultParamRegistry, type ParamRegistry } from '../params';
import type { LogisticsCoefficients, LogisticsNode } from './types';

const KEYS = ['alphaBp', 'maxMultiplierBp', 'betaBp', 'referenceRouteTiles', 'maxDistanceRatioBp', 'readinessReserveBp', 'readinessReadyBp',
  'readinessMovingBp', 'readinessCombatBp', 'minCombatServiceBp', 'graceWindows'] as const;

/** Effective coefficients: registry defaults (the `logistics.coefficients` data row) overlaid with runtime `overrides`. */
export function logisticsCoefficients(
  registry: ParamRegistry = defaultParamRegistry(),
  overrides: Readonly<Record<string, number>> = {},
): LogisticsCoefficients {
  const out: Record<string, number> = {};
  for (const k of KEYS) {
    const path = `logistics.coefficients.${k}`;
    const v = overrides[path] ?? registry.get(path)?.default;
    if (typeof v !== 'number') throw new Error(`logistics: missing coefficient ${path}`);
    out[k] = v;
  }
  return out as unknown as LogisticsCoefficients;
}

/** Registered throughput and reach of a node kind and tier (`logistics.node.<kind>.t<tier>`), or null for an unknown tier. */
export function nodeTierStats(
  kind: LogisticsNode['kind'], tier: number, registry: ParamRegistry = defaultParamRegistry(),
): { readonly throughputPerWindow: number; readonly reachTiles: number } | null {
  const t = registry.get(`logistics.node.${kind}.t${tier}.throughputPerWindow`)?.default;
  const r = registry.get(`logistics.node.${kind}.t${tier}.reachTiles`)?.default;
  return typeof t === 'number' && typeof r === 'number' ? { throughputPerWindow: t, reachTiles: r } : null;
}
