import type { SetDirectorPolicyArgs } from '@terra/contracts';
import { ensureColonyRecord } from '../../kernel/colonies';
import { defineCommandHandler } from '../../kernel/commands';
import type { PlanetState } from '../../kernel/state';
import { setColonyPriorities } from '../goals/priorities';
import { commandColony, parseArgs } from '../command';
import {
  clonePolicy,
  directorRecord,
  ensureDirectorRecord,
  priorityKey,
  saveDirectorRecord,
  supersedeOpenPlans,
  trimPlans,
  type ColonyDirectorRecord,
  type DirectorPlanRef,
} from './store';

function changed(before: ColonyDirectorRecord, patch: SetDirectorPolicyArgs): boolean {
  const policy = before.policy;
  if (patch.risk !== undefined && patch.risk !== policy.risk) return true;
  if (patch.preset !== undefined && patch.preset !== policy.preset) return true;
  if (patch.pause !== undefined && patch.pause !== policy.pause) return true;
  if (patch.note !== undefined && patch.note !== policy.note) return true;
  if (patch.skillAllow !== undefined && patch.skillAllow.join() !== policy.skillAllow.join()) return true;
  if (patch.skillDeny !== undefined && patch.skillDeny.join() !== policy.skillDeny.join()) return true;
  if (!patch.priorities) return false;
  return Object.entries(patch.priorities).some(([key, value]) => value !== undefined && policy.priorities[key as keyof typeof policy.priorities] !== value);
}

function writePatch(record: ColonyDirectorRecord, patch: SetDirectorPolicyArgs): void {
  const policy = record.policy;
  if (patch.risk !== undefined) policy.risk = patch.risk;
  if (patch.preset !== undefined) policy.preset = patch.preset;
  if (patch.pause !== undefined) policy.pause = patch.pause;
  if (patch.note !== undefined) policy.note = patch.note;
  if (patch.skillAllow !== undefined) policy.skillAllow = [...patch.skillAllow];
  if (patch.skillDeny !== undefined) policy.skillDeny = [...patch.skillDeny];
  if (!patch.priorities) return;
  policy.priorities = { ...policy.priorities, ...stripEmpty(patch.priorities) };
}

function stripEmpty(patch: NonNullable<SetDirectorPolicyArgs['priorities']>): Partial<SetDirectorPolicyArgs['priorities']> {
  const out: Partial<SetDirectorPolicyArgs['priorities']> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) out[key as keyof typeof out] = value;
  }
  return out;
}

/**
 * Applies a player policy patch. Does not write `awayRaids` or `autopilotMode`.
 * Any real change bumps `intentRevision` and supersedes open plans (AI §3, §4).
 */
export function applyDirectorPolicy(
  state: PlanetState,
  colonyIndex: number,
  patch: SetDirectorPolicyArgs,
  tick: number,
): { ok: true } | { ok: false; code: 'stale_revision' } {
  const record = ensureDirectorRecord(state, colonyIndex, tick);
  if (patch.expectedRevision !== undefined && patch.expectedRevision !== record.policy.revision) {
    return { ok: false, code: 'stale_revision' };
  }
  if (!changed(record, patch)) {
    record.baselined = true;
    saveDirectorRecord(state, colonyIndex, record, tick);
    return { ok: true };
  }
  writePatch(record, patch);
  record.policy.revision += 1;
  if (patch.priorities) {
    setColonyPriorities(state, colonyIndex, patch.priorities, tick);
    record.baselinePriorities = { ...record.policy.priorities };
    record.overlayUntilTick = null;
  }
  record.seenPriorities = priorityKey(record.policy.priorities);
  supersedeOpenPlans(record);
  record.baselined = true;
  saveDirectorRecord(state, colonyIndex, record, tick);
  return { ok: true };
}

/** Records a plan at the current intent. A later intent bump marks it superseded. */
export function noteDirectorPlan(state: PlanetState, colonyIndex: number, requestId: string, tick: number): DirectorPlanRef {
  const record = ensureDirectorRecord(state, colonyIndex, tick);
  const plan: DirectorPlanRef = { requestId, intentRevision: record.intentRevision, status: 'open' };
  record.plans.push(plan);
  trimPlans(record);
  saveDirectorRecord(state, colonyIndex, record, tick);
  return plan;
}

export function colonyDirector(state: PlanetState, colonyIndex: number) {
  const record = directorRecord(state, colonyIndex);
  if (!record) return undefined;
  return {
    policy: clonePolicy(record.policy),
    intentRevision: record.intentRevision,
    awayRaids: record.awayRaids,
    autopilotMode: record.autopilotMode,
    plans: record.plans.map((plan) => ({ ...plan })),
  };
}

export const setDirectorPolicyHandler = defineCommandHandler({
  kind: 'setDirectorPolicy',
  wave: 'W16',
  handle(state, cmd, ctx) {
    const colonyIndex = commandColony(cmd);
    if (typeof colonyIndex === 'string') return colonyIndex;
    const patch = parseArgs('setDirectorPolicy', cmd.args);
    if (!patch) return 'invalid_args';
    ensureColonyRecord(state, colonyIndex, ctx.tick);
    const applied = applyDirectorPolicy(state, colonyIndex, patch, ctx.tick);
    if (!applied.ok) return applied.code;
  },
});
