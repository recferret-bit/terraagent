import { setBlob, type PlanetState } from '../../kernel/state';

export const RIVAL_AI_BLOB = 'rivalAi';

export type RivalPersona = 'trader' | 'warlord';

export interface RivalColonyMeta {
  colonyIndex: number;
  colonyId: string;
  name: string;
  persona: RivalPersona;
  risk: 'conservative' | 'risky';
  allowWarDiplomacy: boolean;
  anchorQ: number;
  anchorR: number;
  seededAtTick: number;
}

export interface RivalAiBlobValue {
  governorEnabled: boolean;
  seeded: boolean;
  rivals: Record<number, RivalColonyMeta>;
  lastGovernorTickByColony: Record<number, number>;
  lastActionByColony: Record<number, string>;
}

export function emptyRivalAiBlob(): RivalAiBlobValue {
  return {
    governorEnabled: false,
    seeded: false,
    rivals: {},
    lastGovernorTickByColony: {},
    lastActionByColony: {},
  };
}

export function readRivalAiBlob(state: PlanetState): RivalAiBlobValue {
  const raw = state.blobs[RIVAL_AI_BLOB]?.value as Partial<RivalAiBlobValue> | undefined;
  if (!raw || typeof raw !== 'object') return emptyRivalAiBlob();
  return {
    governorEnabled: Boolean(raw.governorEnabled),
    seeded: Boolean(raw.seeded),
    rivals: raw.rivals ? { ...raw.rivals } : {},
    lastGovernorTickByColony: raw.lastGovernorTickByColony ? { ...raw.lastGovernorTickByColony } : {},
    lastActionByColony: raw.lastActionByColony ? { ...raw.lastActionByColony } : {},
  };
}

export function writeRivalAiBlob(
  state: PlanetState,
  value: RivalAiBlobValue,
  tick = state.meta.tick,
): void {
  setBlob(state, RIVAL_AI_BLOB, value, tick);
}

export function enablePlanetGovernor(state: PlanetState, enabled = true, tick = state.meta.tick): void {
  const blob = readRivalAiBlob(state);
  if (blob.governorEnabled === enabled) return;
  blob.governorEnabled = enabled;
  writeRivalAiBlob(state, blob, tick);
}

export function isPlanetGovernorEnabled(state: PlanetState): boolean {
  return readRivalAiBlob(state).governorEnabled;
}

export function isRivalAiColony(state: PlanetState, colonyIndex: number): boolean {
  if (readRivalAiBlob(state).rivals[colonyIndex]) return true;
  const col = state.colonies[colonyIndex] as { isAiColony?: boolean } | undefined;
  return col?.isAiColony === true;
}

export function getRivalColonyMeta(state: PlanetState, colonyIndex: number): RivalColonyMeta | undefined {
  return readRivalAiBlob(state).rivals[colonyIndex];
}

/**
 * Yields a Rival AI colony slot cleanly when a real human player is seated on `colonyIndex`.
 */
export function yieldRivalAiSlotIfNeeded(
  state: PlanetState,
  colonyIndex: number,
  tick = state.meta.tick,
): boolean {
  const blob = readRivalAiBlob(state);
  const meta = blob.rivals[colonyIndex];
  const col = state.colonies[colonyIndex] as { isAiColony?: boolean } | undefined;
  if (!meta && col?.isAiColony !== true) return false;

  delete blob.rivals[colonyIndex];
  delete blob.lastGovernorTickByColony[colonyIndex];
  delete blob.lastActionByColony[colonyIndex];
  writeRivalAiBlob(state, blob, tick);

  // Clear Rival AI entities and tile ownership so spawnColonyLanding starts clean
  const cols = state.entities.cols;
  for (let r = 0; r < state.entities.count; r++) {
    if (cols.owner[r] === colonyIndex) {
      cols.hp[r] = 0;
      cols.owner[r] = -1;
      cols.changedAt[r] = tick;
    }
  }
  const ownerLayer = state.grid.layers.owner;
  for (let i = 0; i < state.grid.count; i++) {
    if (ownerLayer[i] === colonyIndex) ownerLayer[i] = -1;
  }
  if (state.colonies[colonyIndex]) {
    const resetCol = state.colonies[colonyIndex] as Record<string, unknown>;
    delete resetCol.isAiColony;
    resetCol.status = 'eliminated';
    resetCol.aiEnabled = false;
  }
  return true;
}
