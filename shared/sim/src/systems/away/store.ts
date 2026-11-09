import { AWAY_DIRECTIVE_PCT_DEFAULT, AWAY_SESSION_PCT_DEFAULT, type AutopilotMode, type AwayBudget } from '@terra/contracts';
import { setBlob, type PlanetState } from '../../kernel/state';
import type { CompiledDataLike } from '../../kernel/config';
import type { AwayFamily } from './types';
import { AWAY_FAMILIES } from './types';

export interface FamilyBudget {
  perDirectivePct: number;
  perSessionPct: number;
}

export interface ColonyAwaySettings {
  mode: AutopilotMode;
  awayRaids: boolean;
  budget: Record<AwayFamily, FamilyBudget>;
}

interface AwayBlob {
  byColony: Record<string, ColonyAwaySettings>;
}

const BLOB = 'away';

function pct(data: CompiledDataLike, field: 'perDirectivePct' | 'perSessionPct', fallback: number): number {
  const row = (data.tables['away'] as Record<string, Record<string, unknown>> | undefined)?.defaults;
  const n = row?.[field];
  return typeof n === 'number' ? n : fallback;
}

export function defaultFamily(data: CompiledDataLike): FamilyBudget {
  return {
    perDirectivePct: pct(data, 'perDirectivePct', AWAY_DIRECTIVE_PCT_DEFAULT),
    perSessionPct: pct(data, 'perSessionPct', AWAY_SESSION_PCT_DEFAULT),
  };
}

export function emptySettings(data: CompiledDataLike): ColonyAwaySettings {
  const family = defaultFamily(data);
  return {
    mode: 'director',
    awayRaids: false,
    budget: { metals: { ...family }, minerals: { ...family }, bio: { ...family } },
  };
}

export function readAwaySettings(state: PlanetState, colonyIndex: number): ColonyAwaySettings | undefined {
  const blob = state.blobs[BLOB]?.value as AwayBlob | undefined;
  const row = blob?.byColony?.[String(colonyIndex)];
  return row ? structuredClone(row) : undefined;
}

function write(state: PlanetState, colonyIndex: number, settings: ColonyAwaySettings, tick: number): void {
  const prev = (state.blobs[BLOB]?.value as AwayBlob | undefined)?.byColony ?? {};
  setBlob(state, BLOB, { byColony: { ...prev, [String(colonyIndex)]: settings } }, tick);
}

export function applyAutopilot(state: PlanetState, colonyIndex: number, patch: { mode?: AutopilotMode; awayRaids?: boolean; awayBudget?: AwayBudget }, data: CompiledDataLike, tick: number): ColonyAwaySettings {
  const current = readAwaySettings(state, colonyIndex) ?? emptySettings(data);
  if (patch.mode) current.mode = patch.mode;
  if (patch.awayRaids !== undefined) current.awayRaids = patch.awayRaids;
  if (patch.awayBudget) {
    for (const family of AWAY_FAMILIES) {
      const next = patch.awayBudget[family];
      if (!next) continue;
      if (next.perDirectivePct !== undefined) current.budget[family].perDirectivePct = next.perDirectivePct;
      if (next.perSessionPct !== undefined) current.budget[family].perSessionPct = next.perSessionPct;
    }
  }
  write(state, colonyIndex, current, tick);
  return current;
}
