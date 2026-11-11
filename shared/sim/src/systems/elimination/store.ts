import type { ResourceKey } from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { TICKS_PER_SECOND } from '../../kernel/constants';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState } from '../../kernel/state';

export interface ColonyEliminationRecord {
  colonyIndex: number;
  hqDown: boolean;
  lastHqDestroyedTick?: number;
  hqReprintTaskId?: string;
  criticalDeadlineTick?: number;
  eliminatedAtTick?: number;
  eliminatedByColonyId?: string;
  anchorRevertDeadlineTick?: number;
  revertedAnchors?: boolean;
}

export interface RuinRecord {
  entityId: number;
  formerOwner: number;
  createdAtTick: number;
}

export interface EliminationStore {
  byColony: Record<number, ColonyEliminationRecord>;
  ruins: Record<number, RuinRecord>;
}

const DEFAULT_REPRINT_COST: Readonly<Partial<Record<ResourceKey, number>>> = {
  'metals.t1': 200,
  'minerals.t1': 100,
  'bio.biomass': 50,
  'bio.water': 50,
};

export function getEliminationStore(state: PlanetState): EliminationStore {
  const raw = (state.blobs.elimination?.value ?? state.blobs.elimination) as Partial<EliminationStore> | undefined;
  const byColony: Record<number, ColonyEliminationRecord> = {};
  if (raw?.byColony && typeof raw.byColony === 'object') {
    for (const [k, v] of Object.entries(raw.byColony)) {
      if (v && typeof v === 'object') {
        byColony[Number(k)] = { ...v, colonyIndex: Number(k) };
      }
    }
  }
  const ruins: Record<number, RuinRecord> = {};
  if (raw?.ruins && typeof raw.ruins === 'object') {
    for (const [k, v] of Object.entries(raw.ruins)) {
      if (v && typeof v === 'object') {
        ruins[Number(k)] = { ...v, entityId: Number(k) };
      }
    }
  }
  return { byColony, ruins };
}

export function saveEliminationStore(state: PlanetState, store: EliminationStore, tick: number): void {
  setBlob(state, 'elimination', { byColony: store.byColony, ruins: store.ruins }, tick);
}

export function isEntityRuin(state: PlanetState, entityId: number): boolean {
  const store = getEliminationStore(state);
  return Boolean(store.ruins[entityId]);
}

export function ensureColonyEliminationRecord(
  store: EliminationStore,
  colonyIndex: number,
): ColonyEliminationRecord {
  let rec = store.byColony[colonyIndex];
  if (!rec) {
    rec = { colonyIndex, hqDown: false };
    store.byColony[colonyIndex] = rec;
  }
  return rec;
}

export function getColonyEliminationRecord(
  state: PlanetState,
  colonyIndex: number,
): ColonyEliminationRecord | undefined {
  return getEliminationStore(state).byColony[colonyIndex];
}

export function isW18EliminationActive(
  state: PlanetState,
  opts?: { ctx?: StepContext; data?: CompiledDataLike },
): boolean {
  if (opts?.ctx?.flags) {
    return opts.ctx.flags.has('W18');
  }
  const data = opts?.data ?? opts?.ctx?.data;
  if (data?.tables) {
    const dip = (data.tables as Record<string, Record<string, unknown> | undefined>).diplomacy;
    return Boolean(dip?.elimination);
  }
  return Boolean(state.blobs.elimination);
}

function elimRow(data?: CompiledDataLike): Record<string, unknown> | undefined {
  return (data?.tables?.diplomacy as Record<string, Record<string, unknown>> | undefined)?.elimination;
}

export function hqReprintCost(data?: CompiledDataLike): Partial<Record<ResourceKey, number>> {
  const row = elimRow(data);
  const raw = row?.reprintCost as Partial<Record<ResourceKey, number>> | undefined;
  return raw ? { ...raw } : { ...DEFAULT_REPRINT_COST };
}

export function hqReprintTicks(data: CompiledDataLike | undefined, repeated: boolean): number {
  const row = elimRow(data);
  if (repeated) {
    const val = Number(row?.hqReprintRepeatedS);
    return Number.isFinite(val) && val > 0 ? Math.round(val) : 90 * TICKS_PER_SECOND;
  }
  const val = Number(row?.hqReprintS);
  return Number.isFinite(val) && val > 0 ? Math.round(val) : 60 * TICKS_PER_SECOND;
}

export function hqReprintRepeatWindowTicks(data?: CompiledDataLike): number {
  const val = Number(elimRow(data)?.hqReprintRepeatWindowS);
  return Number.isFinite(val) && val > 0 ? Math.round(val) : 600 * TICKS_PER_SECOND;
}

export function criticalTimerTicks(data?: CompiledDataLike): number {
  const val = Number(elimRow(data)?.criticalTimerS);
  return Number.isFinite(val) && val > 0 ? Math.round(val) : 600 * TICKS_PER_SECOND;
}

export function anchorRevertGraceTicks(data?: CompiledDataLike): number {
  const val = Number(elimRow(data)?.anchorRevertGraceS);
  return Number.isFinite(val) && val > 0 ? Math.round(val) : 60 * TICKS_PER_SECOND;
}

export function ruinDecayRatioPerTick(data?: CompiledDataLike): number {
  const val = Number(elimRow(data)?.ruinDecayRatioPerS);
  return Number.isFinite(val) && val > 0 ? val : 0.01 / TICKS_PER_SECOND;
}

export function colonyHasAliveHq(state: PlanetState, colonyIndex: number): boolean {
  const { count, cols } = state.entities;
  for (let r = 0; r < count; r++) {
    if (cols.owner[r] === colonyIndex && cols.kind[r] === ENTITY_KIND.hq && cols.hp[r] > 0) {
      return true;
    }
  }
  return false;
}

export function colonyHasAliveHub(state: PlanetState, colonyIndex: number): boolean {
  const { count, cols } = state.entities;
  for (let r = 0; r < count; r++) {
    if (
      cols.owner[r] === colonyIndex &&
      cols.kind[r] === ENTITY_KIND.commandHub &&
      cols.hp[r] > 0 &&
      cols.state[r] !== ENTITY_STATE.constructing &&
      cols.state[r] !== ENTITY_STATE.inert
    ) {
      return true;
    }
  }
  return false;
}

export function findColonyEntityIdByKind(state: PlanetState, colonyIndex: number, kind: number): number {
  const { count, cols } = state.entities;
  for (let r = 0; r < count; r++) {
    if (cols.owner[r] === colonyIndex && cols.kind[r] === kind && cols.hp[r] > 0) {
      return cols.id[r];
    }
  }
  return -1;
}
