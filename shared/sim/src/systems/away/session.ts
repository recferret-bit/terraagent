import { setBlob, type PlanetState } from '../../kernel/state';
import { AWAY_POLICY_VERSION } from '@terra/contracts';
import type { AwayFamily } from './types';
import { readAwaySettings, type AwaySession, type ColonyAwaySettings } from './store';

export type SpendPurpose = 'auto' | 'defense' | 'repair';

export interface SpendResult {
  readonly allowed: boolean;
  readonly emitted: boolean;
  readonly reason?: 'not-away' | 'budget' | 'bad-amount';
}

interface AwayBlobValue {
  policyVersion: number;
  byColony: Record<string, ColonyAwaySettings>;
}

type Emit = (event: { kind: string; colonyIds?: (string | number)[]; data: Record<string, unknown> }) => void;

function writeSession(state: PlanetState, colonyIndex: number, settings: ColonyAwaySettings, tick: number): void {
  const prev = state.blobs.away?.value as AwayBlobValue | undefined;
  const byColony = { ...(prev?.byColony ?? {}), [String(colonyIndex)]: settings };
  setBlob(state, 'away', { policyVersion: prev?.policyVersion ?? AWAY_POLICY_VERSION, byColony }, tick);
}

/** Opens a session. `start` is the away-start stock of each family. */
export function openAwaySession(state: PlanetState, colonyIndex: number, colonyId: string, start: Record<AwayFamily, number>, tick: number): AwaySession {
  const settings = readAwaySettings(state, colonyIndex);
  if (!settings) throw new Error('away settings missing');
  settings.session = {
    open: true,
    colonyId,
    start: { metals: start.metals, minerals: start.minerals, bio: start.bio },
    spent: { metals: 0, minerals: 0, bio: 0 },
    exhausted: { metals: false, minerals: false, bio: false },
  };
  writeSession(state, colonyIndex, settings, tick);
  return settings.session;
}

function capOf(settings: ColonyAwaySettings, family: AwayFamily): number {
  return (settings.session.start[family] * settings.budget[family].perSessionPct) / 100;
}

function emitExhausted(settings: ColonyAwaySettings, colonyIndex: number, family: AwayFamily, tick: number, emit: Emit): void {
  emit({
    kind: 'awayBudgetExhausted',
    colonyIds: [settings.session.colonyId],
    data: { colonyId: settings.session.colonyId, colonyIndex, resource: family, atTick: tick },
  });
}

/**
 * AW-20. Defense and repair never touch the session cap. An automated spend past the cap
 * is refused and emits `awayBudgetExhausted` once per family per session.
 */
export function chargeAwaySpend(state: PlanetState, colonyIndex: number, family: AwayFamily, amount: number, purpose: SpendPurpose, tick: number, emit: Emit): SpendResult {
  const settings = readAwaySettings(state, colonyIndex);
  if (!settings?.session.open) return { allowed: false, emitted: false, reason: 'not-away' };
  if (amount < 0) return { allowed: false, emitted: false, reason: 'bad-amount' };
  if (purpose !== 'auto') return { allowed: true, emitted: false };
  if (settings.session.spent[family] + amount <= capOf(settings, family)) {
    settings.session.spent[family] += amount;
    writeSession(state, colonyIndex, settings, tick);
    return { allowed: true, emitted: false };
  }
  if (settings.session.exhausted[family]) return { allowed: false, emitted: false, reason: 'budget' };
  settings.session.exhausted[family] = true;
  writeSession(state, colonyIndex, settings, tick);
  emitExhausted(settings, colonyIndex, family, tick, emit);
  return { allowed: false, emitted: true, reason: 'budget' };
}
