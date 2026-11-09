import {
  DEFAULT_DIRECTOR_POLICY,
  type AutopilotMode,
  type DirectorPolicyV1,
  type IndependentPriorities,
} from '@terra/contracts';
import { setBlob, type PlanetState } from '../../kernel/state';

/** Plain blob `director`. MessagePack-safe. Policy outlives context snapshots (AI §10). */
export interface DirectorPlanRef {
  requestId: string;
  intentRevision: number;
  status: 'open' | 'superseded';
}

export interface ColonyDirectorRecord {
  policy: DirectorPolicyV1;
  /** Bumped on player intent changes. Open plans from an older revision are superseded. */
  intentRevision: number;
  /** Player away-raid opt-in. `setAutopilot` writes it. `setDirectorPolicy` does not. Default false. */
  awayRaids: boolean;
  /** `setAutopilot` mode. `setDirectorPolicy` does not write it. Default `director`. */
  autopilotMode: AutopilotMode;
  plans: DirectorPlanRef[];
  baselined: boolean;
  seenPriorities: string;
  seenGoals: string;
  /** Last explicit player sliders. Overlays are measured against this, not against the previous overlay. */
  baselinePriorities: IndependentPriorities;
  /** Tick at which an overlay ends. Null when the effective sliders are the baseline. */
  overlayUntilTick: number | null;
  /** Exclusive tick deadline per goal. An equivalent re-proposal stays quiet while `tick` is below it. */
  suppressUntil: Record<string, number>;
}

interface DirectorBlob {
  byColony: Record<string, ColonyDirectorRecord>;
}

const BLOB = 'director';
const MAX_PLANS = 10;

export function clonePolicy(policy: DirectorPolicyV1): DirectorPolicyV1 {
  return {
    ...policy,
    priorities: { ...policy.priorities },
    skillAllow: [...policy.skillAllow],
    skillDeny: [...policy.skillDeny],
    protectedGoalIds: [...policy.protectedGoalIds],
    protectedEntityIds: [...policy.protectedEntityIds],
    protectedAreas: policy.protectedAreas.map((area) => ({ ...area })),
  };
}

export function priorityKey(priorities: IndependentPriorities): string {
  return [priorities.economy, priorities.expansion, priorities.defense, priorities.power, priorities.terraform].join(',');
}

function emptyRecord(): ColonyDirectorRecord {
  return {
    policy: clonePolicy(DEFAULT_DIRECTOR_POLICY),
    intentRevision: 0,
    awayRaids: false,
    autopilotMode: 'director',
    plans: [],
    baselined: false,
    seenPriorities: '',
    seenGoals: '',
    baselinePriorities: { ...DEFAULT_DIRECTOR_POLICY.priorities },
    overlayUntilTick: null,
    suppressUntil: {},
  };
}

function readBlob(state: PlanetState): DirectorBlob {
  const raw = state.blobs[BLOB]?.value;
  if (!raw || typeof raw !== 'object') return { byColony: {} };
  const byColony = (raw as DirectorBlob).byColony;
  return { byColony: byColony && typeof byColony === 'object' ? byColony : {} };
}

/** A snapshot from before W09-34 has no mode. Missing or unknown becomes `director`. */
function settleMode(record: ColonyDirectorRecord): ColonyDirectorRecord {
  if (record.autopilotMode === 'director' || record.autopilotMode === 'rules_only') return record;
  const autopilotMode: AutopilotMode = 'director';
  try {
    record.autopilotMode = autopilotMode;
    return record;
  } catch {
    return { ...record, autopilotMode };
  }
}

export function directorRecord(state: PlanetState, colonyIndex: number): ColonyDirectorRecord | undefined {
  const row = readBlob(state).byColony[String(colonyIndex)];
  return row ? settleMode(row) : undefined;
}

/** Reads a colony's director record from either a `PlanetState` (`blobs.director.value`) or a `SimView` / `ClientView` (`blobs.director`). */
export function readDirectorView(view: unknown, colonyIndex = 0): ColonyDirectorRecord | undefined {
  if (!view || typeof view !== 'object') return undefined;
  const blobs = (view as { blobs?: Record<string, unknown> }).blobs;
  const raw = blobs?.[BLOB];
  if (!raw || typeof raw !== 'object') return undefined;
  const inner = 'value' in raw && raw.value && typeof raw.value === 'object' ? raw.value : raw;
  const byColony = (inner as DirectorBlob).byColony;
  if (!byColony || typeof byColony !== 'object') return undefined;
  const row = byColony[String(colonyIndex)];
  return row ? settleMode(row) : undefined;
}

export function saveDirectorRecord(state: PlanetState, colonyIndex: number, record: ColonyDirectorRecord, tick: number): void {
  const blob = readBlob(state);
  blob.byColony[String(colonyIndex)] = record;
  setBlob(state, BLOB, blob, tick);
}

export function ensureDirectorRecord(state: PlanetState, colonyIndex: number, tick: number): ColonyDirectorRecord {
  const existing = directorRecord(state, colonyIndex);
  if (existing) return existing;
  const created = emptyRecord();
  saveDirectorRecord(state, colonyIndex, created, tick);
  return created;
}

/** Omitted patch fields stay. A throw is ignored so a missing director table cannot fail `setAutopilot`. */
export function mirrorAutopilotOnDirector(
  state: PlanetState,
  colonyIndex: number,
  patch: { mode?: AutopilotMode; awayRaids?: boolean },
  tick: number,
): void {
  if (patch.mode === undefined && patch.awayRaids === undefined) return;
  try {
    const record = ensureDirectorRecord(state, colonyIndex, tick);
    if (patch.awayRaids !== undefined) record.awayRaids = patch.awayRaids;
    if (patch.mode !== undefined) record.autopilotMode = patch.mode;
    saveDirectorRecord(state, colonyIndex, record, tick);
  } catch {
    // Missing director data must not fail setAutopilot.
  }
}

/** Drops the oldest superseded plans so the blob stays bounded. */
export function trimPlans(record: ColonyDirectorRecord): void {
  if (record.plans.length <= MAX_PLANS) return;
  const superseded = record.plans.filter((plan) => plan.status === 'superseded');
  const open = record.plans.filter((plan) => plan.status === 'open');
  const room = Math.max(0, MAX_PLANS - open.length);
  record.plans = [...superseded.slice(-room), ...open].slice(-MAX_PLANS);
}

export function supersedeOpenPlans(record: ColonyDirectorRecord): void {
  record.intentRevision += 1;
  for (const plan of record.plans) {
    if (plan.status === 'open' && plan.intentRevision < record.intentRevision) plan.status = 'superseded';
  }
  trimPlans(record);
}
