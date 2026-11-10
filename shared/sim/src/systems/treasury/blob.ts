import { TREASURY_EFFECT_KINDS, type TreasuryEffectKind } from '@terra/contracts';
import { setBlob, type PlanetState } from '../../kernel/state';

/** Planet council effects and the meteor-shield strike counters (W22-10, SIM-V-05). */
export const TREASURY_BLOB = 'treasury';

export interface TreasuryEffectRecord {
  untilTick: number;
  magnitudeBp: number;
  visits?: number;
}

export interface TreasuryBlobValue {
  effects: Partial<Record<TreasuryEffectKind, TreasuryEffectRecord>>;
  hazardStrikes: number;
  lightningStrikes: number;
}

export function readTreasury(state: PlanetState): TreasuryBlobValue {
  const raw = state.blobs[TREASURY_BLOB]?.value;
  if (!raw || typeof raw !== 'object') return emptyTreasury();
  const value = raw as Partial<TreasuryBlobValue>;
  return {
    effects: readEffects(value.effects),
    hazardStrikes: countOf(value.hazardStrikes),
    lightningStrikes: countOf(value.lightningStrikes),
  };
}

export function writeTreasury(state: PlanetState, value: TreasuryBlobValue, tick: number): void {
  setBlob(state, TREASURY_BLOB, value, tick);
}

function emptyTreasury(): TreasuryBlobValue {
  return { effects: {}, hazardStrikes: 0, lightningStrikes: 0 };
}

function countOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function readEffects(raw: TreasuryBlobValue['effects'] | undefined): TreasuryBlobValue['effects'] {
  const effects: TreasuryBlobValue['effects'] = {};
  if (!raw || typeof raw !== 'object') return effects;
  for (const kind of TREASURY_EFFECT_KINDS) {
    const row = raw[kind];
    if (!row || typeof row.untilTick !== 'number' || typeof row.magnitudeBp !== 'number') continue;
    const record: TreasuryEffectRecord = { untilTick: row.untilTick, magnitudeBp: row.magnitudeBp };
    if (typeof row.visits === 'number' && row.visits > 0) record.visits = row.visits;
    effects[kind] = record;
  }
  return effects;
}
