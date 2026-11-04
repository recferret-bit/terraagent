import {
  AI_BRIEF_MAX_BYTES,
  ColonyBriefV2Schema,
  DEFAULT_DIRECTOR_POLICY,
  RESOURCE_KEYS,
  utf8Bytes,
  type ColonyBriefV2,
  type DirectorSkillRef,
} from '@terra/contracts';
import type { CompiledDataLike } from '../../kernel/config';
import { TICK_MS } from '../../kernel/constants';
import type { PlanetState } from '../../kernel/state';
import { getColonyStock } from '../../economy/store';
import { getColonyGoals, getColonyHqTier } from '../goals/store';
import { getColonyQueue } from '../queue';
import { getPlanetTime } from '../time';
import { colonyDirector } from './policy';

export interface BriefBuildInput {
  readonly flags: readonly string[];
  readonly data?: CompiledDataLike;
  readonly skills?: readonly DirectorSkillRef[];
}

export type BriefBuildResult =
  | { ok: true; brief: ColonyBriefV2; bytes: number }
  | { ok: false; code: 'context_too_large' | 'invalid' };

/** Byte check used before a brief is trusted. Shared with tests. */
export function guardBriefText(raw: string): 'ok' | 'context_too_large' {
  return utf8Bytes(raw) > AI_BRIEF_MAX_BYTES ? 'context_too_large' : 'ok';
}

function waveList(flags: readonly string[]): string[] {
  return flags.filter((flag) => /^W\d{2}$/.test(flag)).slice(0, 32);
}

function resourceSnaps(state: PlanetState, colonyIndex: number): ColonyBriefV2['resources'] {
  const stock = getColonyStock(state, colonyIndex);
  return RESOURCE_KEYS.map((id) => ({
    id,
    stock: stock[id],
    reserved: 0,
    unearmarked: stock[id],
    netPerMin: 0,
  }));
}

function goalSnaps(state: PlanetState, colonyIndex: number): ColonyBriefV2['goals'] {
  return getColonyGoals(state, colonyIndex).slice(0, 16).map((goal) => ({
    id: goal.id,
    goal: goal.goal,
    status: goal.status,
    locked: false,
    source: 'player' as const,
  }));
}

/** Player-precedence orders only. Does not walk the tile atlas. */
function orderSnaps(state: PlanetState, colonyIndex: number): ColonyBriefV2['manualOrders'] {
  return getColonyQueue(state, colonyIndex)
    .filter((entry) => entry.precedence === 'player')
    .slice(0, 32)
    .map((entry) => ({ id: entry.taskId.slice(0, 64), kind: entry.task.kind }));
}

function assemble(state: PlanetState, colonyIndex: number, opts: BriefBuildInput): ColonyBriefV2 {
  const colony = state.colonies[colonyIndex];
  const director = colonyDirector(state, colonyIndex);
  const policy = director?.policy ?? DEFAULT_DIRECTOR_POLICY;
  const stage = typeof colony?.stage === 'number' ? Math.max(0, Math.min(20, Math.floor(colony.stage))) : 0;
  const time = getPlanetTime(state, opts.data);
  const flags = waveList(opts.flags);
  return {
    version: 2,
    worldId: state.meta.planetId,
    colonyId: colony?.id ?? `col_${colonyIndex}`,
    planetId: state.meta.planetId,
    colonyIndex,
    atlasVersion: String(state.meta.genVersion ?? 0),
    configVersion: 'director-v2',
    epoch: state.meta.pathEpoch ?? 0,
    tick: state.meta.tick,
    simTimeS: (state.meta.tick * TICK_MS) / 1000,
    observedAtSimS: (state.meta.tick * TICK_MS) / 1000,
    intentRevision: director?.intentRevision ?? 0,
    goalRevision: goalSnaps(state, colonyIndex).length,
    permissionRevision: policy.permissionRevision,
    enabledWaves: flags as ColonyBriefV2['enabledWaves'],
    unlockStage: stage,
    hqTier: getColonyHqTier(state, colonyIndex),
    resources: resourceSnaps(state, colonyIndex),
    power: { netPerS: 0, solar: time.phase, collapsed: false },
    goals: goalSnaps(state, colonyIndex),
    manualOrders: orderSnaps(state, colonyIndex),
    policy,
    threats: [],
    sectors: [],
    skills: (opts.skills ?? []).slice(0, 6).map((skill) => ({ ...skill })),
    recentEvents: [],
    recentDecisions: [],
    capabilities: {
      w11: flags.includes('W11'),
      w27: flags.includes('W27'),
      away: flags.includes('W09'),
      guild: flags.includes('W15'),
    },
  };
}

/**
 * Bounded colony brief (AI §5). Reads goals, player orders, stock and policy.
 * `sectors` stays empty here: filling them is the W11 adapter, and this function does not iterate tiles.
 */
export function buildColonyBrief(state: PlanetState, colonyIndex: number, opts: BriefBuildInput): BriefBuildResult {
  const draft = assemble(state, colonyIndex, opts);
  const raw = JSON.stringify(draft);
  if (guardBriefText(raw) === 'context_too_large') return { ok: false, code: 'context_too_large' };
  const parsed = ColonyBriefV2Schema.safeParse(draft);
  if (!parsed.success) return { ok: false, code: 'invalid' };
  return { ok: true, brief: parsed.data, bytes: utf8Bytes(raw) };
}
