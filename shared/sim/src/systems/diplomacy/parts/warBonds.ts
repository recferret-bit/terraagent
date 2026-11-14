import {
  WAR_BOND_DURATION_HOURS,
  WAR_OBJECTIVE_SIPHON,
  WAR_OBJECTIVE_STRUCTURES,
  type DiplomacyBondToken,
  type RejectCode,
} from '@terra/contracts';
import { TICKS_PER_SECOND } from '../../../kernel/constants';
import type { StepContext } from '../../../kernel/context';
import type { PlanetState } from '../../../kernel/state';
import { dropColonyShield, isColonyRaidProtected } from '../../pvp/shield';
import { getColonyHqRowAndTier, hasFirstContact } from '../rules';
import {
  DIPLOMACY_BLOB,
  hasActiveTruce,
  hasActiveWar,
  pairKey,
  readDiplomacyBlob,
  resolveColonyIdStr,
  resolveColonyIndex,
  writeDiplomacyBlob,
  type DiplomacyBlobValue,
  type StoredWarRecord,
} from '../store';

export type DeclareWarResult =
  | { ok: true; war: StoredWarRecord }
  | { ok: false; code: RejectCode; detail: string };

export type CancelWarResult =
  | { ok: true; war: StoredWarRecord }
  | { ok: false; code: RejectCode; detail: string };

export function warBondDurationTicks(): number {
  return WAR_BOND_DURATION_HOURS * 3600 * TICKS_PER_SECOND;
}

function emitWarEnded(
  war: StoredWarRecord,
  reason: 'objective_met' | 'cancelled' | 'expired' | 'eliminated',
  tick: number,
  ctx?: StepContext,
  cancelledBy?: number,
): void {
  const slashedToDefender = reason === 'cancelled' || reason === 'expired' || reason === 'eliminated';
  ctx?.emit({
    kind: 'warEnded',
    severity: slashedToDefender ? 'warn' : 'info',
    colonyIds: [war.attackerColonyId, war.defenderColonyId],
    data: {
      warId: war.warId,
      attackerColony: war.attackerColonyIndex,
      defenderColony: war.defenderColonyIndex,
      attackerColonyId: war.attackerColonyId,
      defenderColonyId: war.defenderColonyId,
      attackerColonyIndex: war.attackerColonyIndex,
      defenderColonyIndex: war.defenderColonyIndex,
      reason,
      ...(cancelledBy !== undefined ? { cancelledBy } : {}),
      endedAtTick: tick,
      bondToken: war.bondToken,
      bondAmount: war.bondAmount,
      structuresDestroyed: war.structuresDestroyed,
      resourcesSiphoned: Math.round(war.resourcesSiphoned * 1000) / 1000,
      slashedToDefender,
    },
  });
}

function validateWarDeclaration(
  state: PlanetState,
  attackerColony: number,
  defenderColony: number,
  bondAmount: number,
  tick: number,
  ctx?: StepContext,
): { ok: true } | { ok: false; code: RejectCode; detail: string } {
  if (attackerColony < 0 || defenderColony < 0 || attackerColony === defenderColony) {
    return { ok: false, code: 'invalid_args', detail: 'invalid target colony' };
  }
  if (typeof bondAmount !== 'number' || !Number.isFinite(bondAmount) || bondAmount <= 0) {
    return { ok: false, code: 'invalid_args', detail: 'war bond amount must be positive' };
  }
  const colA = state.colonies.find((c) => c && c.index === attackerColony) ?? state.colonies[attackerColony];
  const colB = state.colonies.find((c) => c && c.index === defenderColony) ?? state.colonies[defenderColony];
  if (colA?.status === 'eliminated' || colB?.status === 'eliminated') {
    return { ok: false, code: 'invalid_args', detail: 'colony eliminated' };
  }
  if (!getColonyHqRowAndTier(state, attackerColony).alive || !getColonyHqRowAndTier(state, defenderColony).alive) {
    return { ok: false, code: 'invalid_args', detail: 'both HQs must be alive' };
  }
  if (!hasFirstContact(state, attackerColony, defenderColony)) {
    return { ok: false, code: 'no_contact', detail: 'first contact required' };
  }
  if (hasActiveTruce(state, attackerColony, defenderColony, tick)) {
    return { ok: false, code: 'truce_active', detail: 'cannot declare war during active truce' };
  }
  if (isColonyRaidProtected(state, defenderColony, tick, ctx?.data)) {
    return { ok: false, code: 'raid_protected', detail: 'target colony is raid protected' };
  }
  if (hasActiveWar(state, attackerColony, defenderColony, tick)) {
    return { ok: false, code: 'war_active', detail: 'bonded war already active against target' };
  }
  return { ok: true };
}

export function declareWar(
  state: PlanetState,
  attackerColony: number,
  targetRef: number | string,
  bondAmount: number,
  bondToken: DiplomacyBondToken = 'NEAR',
  tick: number = state.meta.tick,
  ctx?: StepContext,
): DeclareWarResult {
  const defenderColony = resolveColonyIndex(state, targetRef);
  const check = validateWarDeclaration(state, attackerColony, defenderColony, bondAmount, tick, ctx);
  if (!check.ok) return check;

  const blob = readDiplomacyBlob(state);
  const warId = `war_${blob.nextWarSeq++}`;
  const attackerColonyId = resolveColonyIdStr(state, attackerColony);
  const defenderColonyId = resolveColonyIdStr(state, defenderColony);
  const expiresAtTick = tick + warBondDurationTicks();

  const war: StoredWarRecord = {
    warId,
    attackerColony,
    defenderColony,
    attackerColonyIndex: attackerColony,
    defenderColonyIndex: defenderColony,
    attackerColonyId,
    defenderColonyId,
    bondToken,
    bondAmount,
    declaredAtTick: tick,
    expiresAtTick,
    structuresDestroyed: 0,
    resourcesSiphoned: 0,
    status: 'active',
  };
  blob.wars[warId] = war;
  blob.lastHostilityByPair[pairKey(attackerColony, defenderColony)] = tick;
  writeDiplomacyBlob(state, blob, tick);
  dropColonyShield(state, attackerColony, tick, ctx?.data);

  ctx?.emit({
    kind: 'warDeclared',
    severity: 'warn',
    colonyIds: [attackerColonyId, defenderColonyId],
    data: {
      warId,
      attackerColony,
      defenderColony,
      attackerColonyId,
      defenderColonyId,
      attackerColonyIndex: attackerColony,
      defenderColonyIndex: defenderColony,
      bondToken,
      bondAmount,
      declaredAtTick: tick,
      expiresAtTick,
    },
  });
  return { ok: true, war };
}

export function cancelWar(
  state: PlanetState,
  callerColony: number,
  warIdOrTargetRef: string,
  tick: number = state.meta.tick,
  ctx?: StepContext,
): CancelWarResult {
  const blob = readDiplomacyBlob(state);
  const targetIdx = resolveColonyIndex(state, warIdOrTargetRef);
  const war =
    blob.wars[warIdOrTargetRef] ??
    Object.values(blob.wars).find(
      (w) =>
        w.status === 'active' &&
        w.attackerColonyIndex === callerColony &&
        (w.warId === warIdOrTargetRef ||
          w.defenderColonyId === warIdOrTargetRef ||
          (targetIdx >= 0 && w.defenderColonyIndex === targetIdx)),
    );

  if (!war || war.status !== 'active' || war.attackerColonyIndex !== callerColony) {
    return { ok: false, code: 'unknown_war', detail: 'active declared war not found' };
  }

  war.status = 'cancelled';
  war.endReason = 'cancelled';
  war.endedAtTick = tick;
  writeDiplomacyBlob(state, blob, tick);
  emitWarEnded(war, 'cancelled', tick, ctx, callerColony);
  return { ok: true, war };
}

export function recordWarStructureDestroyed(
  state: PlanetState,
  attackerColony: number,
  defenderColony: number,
  tick: number = state.meta.tick,
  ctx?: StepContext,
): void {
  if (attackerColony < 0 || defenderColony < 0 || attackerColony === defenderColony) return;
  const raw = state.blobs[DIPLOMACY_BLOB]?.value as Partial<DiplomacyBlobValue> | undefined;
  if (!raw?.wars) return;

  const blob = readDiplomacyBlob(state);
  let changed = false;
  for (const war of Object.values(blob.wars)) {
    if (
      war.status === 'active' &&
      war.expiresAtTick > tick &&
      war.attackerColonyIndex === attackerColony &&
      war.defenderColonyIndex === defenderColony
    ) {
      war.structuresDestroyed += 1;
      changed = true;
      if (war.structuresDestroyed >= WAR_OBJECTIVE_STRUCTURES) {
        war.status = 'completed';
        war.endReason = 'objective_met';
        war.endedAtTick = tick;
        emitWarEnded(war, 'objective_met', tick, ctx);
      }
    }
  }
  if (changed) writeDiplomacyBlob(state, blob, tick);
}

export function recordWarSiphonProgress(
  state: PlanetState,
  attackerColony: number,
  defenderColony: number,
  amountSiphoned: number,
  tick: number = state.meta.tick,
  ctx?: StepContext,
): void {
  if (amountSiphoned <= 0 || attackerColony < 0 || defenderColony < 0 || attackerColony === defenderColony) return;
  const raw = state.blobs[DIPLOMACY_BLOB]?.value as Partial<DiplomacyBlobValue> | undefined;
  if (!raw?.wars) return;

  const blob = readDiplomacyBlob(state);
  let changed = false;
  for (const war of Object.values(blob.wars)) {
    if (
      war.status === 'active' &&
      war.expiresAtTick > tick &&
      war.attackerColonyIndex === attackerColony &&
      war.defenderColonyIndex === defenderColony
    ) {
      war.resourcesSiphoned = Math.round((war.resourcesSiphoned + amountSiphoned) * 1_000_000) / 1_000_000;
      changed = true;
      if (war.resourcesSiphoned >= WAR_OBJECTIVE_SIPHON) {
        war.status = 'completed';
        war.endReason = 'objective_met';
        war.endedAtTick = tick;
        emitWarEnded(war, 'objective_met', tick, ctx);
      }
    }
  }
  if (changed) writeDiplomacyBlob(state, blob, tick);
}

export function cancelColonyWarsOnElimination(
  blob: DiplomacyBlobValue,
  eliminatedColony: number,
  tick: number,
  ctx?: StepContext,
): boolean {
  let changed = false;
  for (const war of Object.values(blob.wars)) {
    if (
      war.status === 'active' &&
      (war.attackerColonyIndex === eliminatedColony || war.defenderColonyIndex === eliminatedColony)
    ) {
      const reason = war.defenderColonyIndex === eliminatedColony ? 'objective_met' : 'eliminated';
      war.status = reason === 'objective_met' ? 'completed' : 'eliminated';
      war.endReason = reason;
      war.endedAtTick = tick;
      changed = true;
      emitWarEnded(war, reason, tick, ctx);
    }
  }
  return changed;
}

export function stepWars(blob: DiplomacyBlobValue, tick: number, ctx: StepContext): boolean {
  let changed = false;
  for (const war of Object.values(blob.wars)) {
    if (war.status !== 'active') continue;
    if (war.structuresDestroyed >= WAR_OBJECTIVE_STRUCTURES || war.resourcesSiphoned >= WAR_OBJECTIVE_SIPHON) {
      war.status = 'completed';
      war.endReason = 'objective_met';
      war.endedAtTick = tick;
      changed = true;
      emitWarEnded(war, 'objective_met', tick, ctx);
    } else if (tick >= war.expiresAtTick) {
      war.status = 'expired';
      war.endReason = 'expired';
      war.endedAtTick = tick;
      changed = true;
      emitWarEnded(war, 'expired', tick, ctx);
    }
  }
  return changed;
}
