import type { AutoTradeLimits } from '@terra/contracts';
import { setBlob, type PlanetState } from '../../../kernel/state';
import { AUTO_TRADE_BLOB } from './tier';

interface AutoTradeBlob {
  readonly byColony: Readonly<Record<string, AutoTradeLimits>>;
}

function copyLimits(limits: AutoTradeLimits): AutoTradeLimits {
  return JSON.parse(JSON.stringify(limits)) as AutoTradeLimits;
}

function byColony(state: PlanetState): Record<string, AutoTradeLimits> {
  const raw = state.blobs[AUTO_TRADE_BLOB]?.value as Partial<AutoTradeBlob> | undefined;
  const rows = raw?.byColony;
  if (!rows || typeof rows !== 'object') return {};
  return { ...rows };
}

/** Stored limits for one colony, or undefined when `setAutoTrade` has never written them. */
export function readAutoTradeLimits(state: PlanetState, colonyIndex: number): AutoTradeLimits | undefined {
  const row = byColony(state)[String(colonyIndex)];
  return row ? copyLimits(row) : undefined;
}

export function writeAutoTradeLimits(state: PlanetState, colonyIndex: number, limits: AutoTradeLimits, tick: number): void {
  const prev = byColony(state);
  prev[String(colonyIndex)] = copyLimits(limits);
  setBlob(state, AUTO_TRADE_BLOB, { byColony: prev }, tick);
}
