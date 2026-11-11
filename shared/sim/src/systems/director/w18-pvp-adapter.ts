import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState } from '../../kernel/state';
import {
  isCancelTruce,
  isProposeTruce,
  isRaidCommand,
  isRespondTruce,
  isTruceCommand,
  withinDiplomacyPolicy,
} from '../away/orders';
import {
  hasActiveTruce,
  isColonyOathbreaker,
  resolveColonyIndex,
} from '../diplomacy/store';
import { canRaidTargetSector } from '../pvp/sectorGuard';
import { isColonyRaidProtected } from '../pvp/shield';
import type { StrategyPermissions } from './permissions';

export interface DirectorActionPermissionInput {
  readonly action: { readonly kind: string; readonly args?: unknown };
  readonly waves?: ReadonlySet<string> | { has(wave: string): boolean };
  readonly away?: boolean;
  readonly awayRaids?: boolean;
  readonly permissions?: StrategyPermissions;
  readonly state?: PlanetState;
  readonly colonyIndex?: number;
  readonly tick?: number;
  readonly data?: CompiledDataLike;
}

export type DirectorActionPermissionResult =
  | { readonly ok: true; readonly skillId?: 'diplomacy' }
  | { readonly ok: false; readonly code: string; readonly reason: string; readonly rule?: string };

export type AggressionSkillProposalResult =
  | {
      readonly ok: true;
      readonly eligibleTargets: readonly number[];
      readonly recommendedTargetColony: number | null;
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly reason: string;
    };

function extractRaidTargetRef(args: unknown): unknown {
  if (!args || typeof args !== 'object') return undefined;
  const rec = args as Record<string, unknown>;

  const direct = rec.targetColonyId ?? rec.targetColonyIndex ?? rec.targetColony ?? rec.target;
  if (direct !== undefined) return direct;

  if (rec.raid && typeof rec.raid === 'object') {
    const raidObj = rec.raid as Record<string, unknown>;
    const inRaid = raidObj.targetColonyId ?? raidObj.targetColonyIndex ?? raidObj.targetColony ?? raidObj.target;
    if (inRaid !== undefined) return inRaid;
  }

  if (rec.params && typeof rec.params === 'object') {
    const paramsObj = rec.params as Record<string, unknown>;
    const inParams = paramsObj.targetColonyId ?? paramsObj.targetColonyIndex ?? paramsObj.targetColony ?? paramsObj.target;
    if (inParams !== undefined) return inParams;
  }

  if (rec.goal && typeof rec.goal === 'object') {
    const goalObj = rec.goal as Record<string, unknown>;
    const inGoal = goalObj.targetColonyId ?? goalObj.targetColonyIndex ?? goalObj.targetColony ?? goalObj.target;
    if (inGoal !== undefined) return inGoal;
    if (goalObj.params && typeof goalObj.params === 'object') {
      const gp = goalObj.params as Record<string, unknown>;
      const inGp = gp.targetColonyId ?? gp.targetColonyIndex ?? gp.targetColony ?? gp.target;
      if (inGp !== undefined) return inGp;
    }
  }

  if (rec.task && typeof rec.task === 'object') {
    const taskObj = rec.task as Record<string, unknown>;
    const inTask = taskObj.targetColonyId ?? taskObj.targetColonyIndex ?? taskObj.targetColony ?? taskObj.target;
    if (inTask !== undefined) return inTask;
    if (taskObj.raid && typeof taskObj.raid === 'object') {
      const tr = taskObj.raid as Record<string, unknown>;
      const inTr = tr.targetColonyId ?? tr.targetColonyIndex ?? tr.targetColony ?? tr.target;
      if (inTr !== undefined) return inTr;
    }
  }

  return undefined;
}

function checkRaidTargetState(
  input: DirectorActionPermissionInput,
  tick: number,
): DirectorActionPermissionResult | null {
  if (!input.state || input.colonyIndex === undefined) return null;

  const targetRef = extractRaidTargetRef(input.action.args);
  const targetColony = resolveColonyIndex(input.state, targetRef as string | number | undefined);
  if (
    targetColony < 0 ||
    targetColony >= input.state.colonies.length ||
    !input.state.colonies[targetColony] ||
    targetColony === input.colonyIndex
  ) {
    return { ok: false, code: 'invalid_target', reason: 'Invalid raid target colony' };
  }

  const sectorCheck = canRaidTargetSector(input.state, input.colonyIndex, targetColony);
  if (!sectorCheck.ok) {
    return { ok: false, code: 'cross_sector_disabled', reason: 'Cross-sector raids are disabled' };
  }

  if (hasActiveTruce(input.state, input.colonyIndex, targetColony, tick)) {
    return { ok: false, code: 'truce_active', reason: 'Active truce with target colony' };
  }

  if (isColonyRaidProtected(input.state, targetColony, tick, input.data)) {
    return { ok: false, code: 'raid_protected', reason: 'Target colony has newcomer shield' };
  }

  return null;
}

export function checkDirectorActionPermission(
  input: DirectorActionPermissionInput,
): DirectorActionPermissionResult {
  const cmd = {
    kind: input.action.kind,
    args: input.action.args ?? {},
  };

  // Rule 1: Waves check (W18 required for raid or truce commands)
  if (input.waves && !input.waves.has('W18') && (isRaidCommand(cmd) || isTruceCommand(cmd))) {
    return { ok: false, code: 'wave_disabled', reason: 'W18 is disabled' };
  }

  // Rule 2: AI / director may NEVER cancel an active truce (AW-13)
  if (isCancelTruce(cmd)) {
    return { ok: false, code: 'away_policy', rule: 'AW-13', reason: 'AI director may never cancel a truce' };
  }

  // Rule 3: Raid commands
  if (isRaidCommand(cmd)) {
    if (input.away && !input.awayRaids) {
      return { ok: false, code: 'away_policy', rule: 'AW-11', reason: 'awayRaids is disabled' };
    }
    if (input.away === undefined && input.permissions && !input.permissions.raids && input.awayRaids !== true) {
      return { ok: false, code: 'away_policy', rule: 'AW-11', reason: 'awayRaids is disabled' };
    }
    if (input.permissions && !input.permissions.raids && input.awayRaids !== true) {
      return { ok: false, code: 'away_policy', rule: 'AW-11', reason: 'raid strategy permission disabled' };
    }

    const tick = input.tick ?? (input.state ? input.state.meta.tick : 0);
    const targetError = checkRaidTargetState(input, tick);
    if (targetError) return targetError;

    return { ok: true, skillId: 'diplomacy' };
  }

  // Rule 4: Truce propose or respond
  if (isProposeTruce(cmd) || isRespondTruce(cmd)) {
    if (!withinDiplomacyPolicy({}, cmd)) {
      return { ok: false, code: 'away_policy', rule: 'AW-13', reason: 'Invalid diplomacy parameters' };
    }

    if (isProposeTruce(cmd) && input.state && input.colonyIndex !== undefined) {
      const tick = input.tick ?? input.state.meta.tick;
      if (isColonyOathbreaker(input.state, input.colonyIndex, tick)) {
        return { ok: false, code: 'oathbreaker', reason: 'Colony has Oathbreaker mark' };
      }
    }

    return { ok: true, skillId: 'diplomacy' };
  }

  // Rule 5: Other actions permitted by default
  return { ok: true };
}

export function evaluateAggressionSkillProposal(
  state: PlanetState,
  colonyIndex: number,
  opts?: {
    away?: boolean;
    awayRaids?: boolean;
    waves?: ReadonlySet<string> | { has(wave: string): boolean };
    tick?: number;
    data?: CompiledDataLike;
  },
): AggressionSkillProposalResult {
  const perm = checkDirectorActionPermission({
    action: { kind: 'raid' },
    waves: opts?.waves,
    away: opts?.away,
    awayRaids: opts?.awayRaids,
    data: opts?.data,
  });
  if (!perm.ok) {
    return { ok: false, code: perm.code, reason: perm.reason };
  }

  if (colonyIndex < 0 || colonyIndex >= state.colonies.length) {
    return { ok: false, code: 'invalid_colony', reason: 'Invalid colony index' };
  }

  const tick = opts?.tick ?? state.meta.tick;
  const eligibleTargets: number[] = [];

  for (let i = 0; i < state.colonies.length; i++) {
    if (i === colonyIndex) continue;
    const col = state.colonies[i];
    if (!col || col.status === 'eliminated') continue;

    const sectorCheck = canRaidTargetSector(state, colonyIndex, i);
    if (!sectorCheck.ok) continue;

    if (hasActiveTruce(state, colonyIndex, i, tick)) continue;

    if (isColonyRaidProtected(state, i, tick, opts?.data)) continue;

    eligibleTargets.push(i);
  }

  eligibleTargets.sort((a, b) => a - b);
  const recommendedTargetColony = eligibleTargets.length > 0 ? eligibleTargets[0]! : null;

  return {
    ok: true,
    eligibleTargets,
    recommendedTargetColony,
  };
}
