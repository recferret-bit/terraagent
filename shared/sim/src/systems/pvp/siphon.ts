import {
  RESOURCE_FAMILY_OF,
  RESOURCE_KEYS,
  type ResourceFamily,
  type ResourceKey,
} from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { fromMicro, toMicro, valueMicro } from '../../economy/residual';
import { hexDistance } from '../../grid/hex';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import type { ColonyState, PlanetState } from '../../kernel/state';
import { footprintAttackRange } from '../combat/approachBand';
import { getEntityFootprintSize } from '../combat/vision';
import { hasActiveTruce, recordHostilityBetween } from '../diplomacy/store';
import {
  consumeResource,
  creditResource,
  ensureColonyAt,
  ensureColonyLedger,
  resourceValue,
} from '../economy/ledger';
import { isRaidCombatUnitRow } from './raidTask';
import { dropColonyShield, isColonyRaidProtected } from './shield';
import {
  ensureColonyPvpRecord,
  getPvpState,
  isW18PvpActive,
  resolvePvpConfig,
  savePvpState,
} from './store';

/** Returns `true` when `kind` is a foreign storage/hub building eligible for PvP resource siphoning (`W18-05`). */
export function isSiphonTargetBuildingKind(kind: number): boolean {
  return (
    kind === ENTITY_KIND.supplyDepot ||
    kind === ENTITY_KIND.commandHub ||
    kind === ENTITY_KIND.hub
  );
}

/**
 * Finds the nearest living foreign Depot/Hub within `siphonRangeTiles` (`1` tile from footprint edge)
 * of attacker unit `unitRow`, or returns `-1` if none is in range.
 */
export function findForeignSiphonBuildingInRange(
  state: PlanetState,
  unitRow: number,
  tick = state.meta.tick,
  data?: CompiledDataLike,
): number {
  if (!isRaidCombatUnitRow(state, unitRow, data)) return -1;
  const cols = state.entities.cols;
  const attackerOwner = cols.owner[unitRow]!;
  if (attackerOwner < 0) return -1;

  const cfg = resolvePvpConfig(data);
  const uq = cols.q[unitRow]!;
  const ur = cols.r[unitRow]!;
  let bestRow = -1;
  let bestDist = Infinity;
  let bestId = Infinity;

  for (let r = 0; r < state.entities.count; r++) {
    if (r === unitRow) continue;
    const targetOwner = cols.owner[r]!;
    if (targetOwner < 0 || targetOwner === attackerOwner) continue;
    if (cols.hp[r]! <= 0) continue;
    const st = cols.state[r]!;
    if (st === ENTITY_STATE.constructing || st === ENTITY_STATE.inert || st === ENTITY_STATE.descending) {
      continue;
    }
    const kind = cols.kind[r]!;
    if (!isSiphonTargetBuildingKind(kind)) continue;
    if (hasActiveTruce(state, attackerOwner, targetOwner, tick)) continue;
    if (isColonyRaidProtected(state, targetOwner, tick, data)) continue;

    const fw = Math.max(
      1,
      cols.footprintW[r] || cols.footprintD[r] || getEntityFootprintSize(kind, data),
    );
    const maxDist = footprintAttackRange(cfg.siphonRangeTiles, fw);
    const d = hexDistance(uq, ur, cols.q[r]!, cols.r[r]!);
    if (d > maxDist + 1e-5) continue;

    const id = cols.id[r]!;
    if (d < bestDist - 1e-5 || (Math.abs(d - bestDist) <= 1e-5 && id < bestId)) {
      bestDist = d;
      bestId = id;
      bestRow = r;
    }
  }
  return bestRow;
}

function remainingFamilyRoomUnits(colony: ColonyState, family: ResourceFamily): number {
  const c = ensureColonyLedger(colony);
  let usedMicro = 0;
  for (const k of RESOURCE_KEYS) {
    if (RESOURCE_FAMILY_OF[k] === family) {
      usedMicro += valueMicro(c.stock[k] ?? 0, c.residual[k] ?? 0);
    }
  }
  const reserved = Number(
    (colony.cargo as { reservedByFamily?: Partial<Record<ResourceFamily, number>> } | undefined)
      ?.reservedByFamily?.[family] ?? 0,
  );
  const capMicro = toMicro(c.caps[family] ?? 0) - toMicro(Math.max(0, reserved));
  return fromMicro(Math.max(0, capMicro - usedMicro));
}

/** Returns how much of `key` (or total across all keys if `key` is omitted) `unitId` has siphoned. */
export function getUnitSiphonedAmount(
  state: PlanetState,
  colonyIndex: number,
  unitId: number,
  key?: ResourceKey,
): number {
  const pvp = getPvpState(state);
  const rec = pvp.byColony[String(colonyIndex)];
  const map = rec?.siphonCarryingByUnit?.[unitId];
  if (!map) return 0;
  if (key) return Number(map[key] ?? 0);
  let sum = 0;
  for (const v of Object.values(map)) sum += Number(v ?? 0);
  return sum;
}

/** Resets stored siphon carry counters for `unitId` of `colonyIndex`. */
export function resetUnitSiphonCarry(
  state: PlanetState,
  colonyIndex: number,
  unitId: number,
  tick = state.meta.tick,
): void {
  const rec = ensureColonyPvpRecord(state, colonyIndex, tick);
  if (!rec.siphonCarryingByUnit?.[unitId]) return;
  const pvp = getPvpState(state);
  const colRec = pvp.byColony[String(colonyIndex)];
  if (colRec?.siphonCarryingByUnit) {
    delete colRec.siphonCarryingByUnit[unitId];
    savePvpState(state, pvp, tick);
  }
}

function siphonFromBuildingForUnit(
  state: PlanetState,
  unitRow: number,
  buildingRow: number,
  dt: number,
  tick: number,
  data?: CompiledDataLike,
): boolean {
  const cols = state.entities.cols;
  const unitId = cols.id[unitRow]!;
  const attackerIdx = cols.owner[unitRow]!;
  const victimIdx = cols.owner[buildingRow]!;
  const colA = ensureColonyAt(state, attackerIdx, tick);
  const colB = ensureColonyAt(state, victimIdx, tick);
  const cfg = resolvePvpConfig(data);
  const rateAmount = cfg.siphonRatePerTick * Math.max(1, dt);

  ensureColonyPvpRecord(state, attackerIdx, tick, data);
  const pvpState = getPvpState(state);
  const attackerRec = pvpState.byColony[String(attackerIdx)]!;
  const byUnit = attackerRec.siphonCarryingByUnit ? { ...attackerRec.siphonCarryingByUnit } : {};
  const unitCarried: Partial<Record<string, number>> = byUnit[unitId] ? { ...byUnit[unitId] } : {};

  let transferredAny = false;
  for (const key of RESOURCE_KEYS) {
    const bAvail = resourceValue(colB, key);
    if (bAvail <= 1e-9) continue;

    const alreadyCarried = Number(unitCarried[key] ?? 0);
    const carryRoom = Math.max(0, cfg.siphonCarryCap - alreadyCarried);
    if (carryRoom <= 1e-9) continue;

    const family = RESOURCE_FAMILY_OF[key];
    const familyRoom = remainingFamilyRoomUnits(colA, family);
    if (familyRoom <= 1e-9) continue;

    const amount = Math.min(rateAmount, bAvail, carryRoom, familyRoom);
    if (amount <= 1e-9) continue;

    const taken = consumeResource(colB, key, amount, tick, 'production.consume');
    if (taken <= 0) continue;

    creditResource(colA, key, taken, tick, { produced: false, reason: 'production.tick' });
    unitCarried[key] = Math.round((alreadyCarried + taken) * 1_000_000) / 1_000_000;
    transferredAny = true;
  }

  if (transferredAny) {
    byUnit[unitId] = unitCarried;
    attackerRec.siphonCarryingByUnit = byUnit;
    pvpState.byColony[String(attackerIdx)] = attackerRec;
    savePvpState(state, pvpState, tick);
    dropColonyShield(state, attackerIdx, tick, data);
    recordHostilityBetween(state, attackerIdx, victimIdx, tick);
  }
  return transferredAny;
}

/**
 * Steps PvP resource siphoning (`W18-05`, `UO-W-08`, `DI-16`, SIM §7.7):
 * - Each living combat unit (`Recon`) parked within `siphonRangeTiles` (`1` tile from footprint edge)
 *   of a foreign `supplyDepot` or `commandHub` siphons `1 unit/s` (`0.2/tick`) of each `ResourceKey`
 *   the victim colony holds, up to `siphonCarryCap` (`40`) per unit and clamped by the attacker's
 *   family storage caps (`colA.caps[family]`).
 */
export function stepRaidSiphon(state: PlanetState, ctx: StepContext): void {
  if (!ctx.flags.has('W18') || !isW18PvpActive(ctx.data)) return;
  const cols = state.entities.cols;
  for (let row = 0; row < state.entities.count; row++) {
    if (cols.owner[row]! < 0 || cols.hp[row]! <= 0) continue;
    if (!isRaidCombatUnitRow(state, row, ctx.data)) continue;
    const bRow = findForeignSiphonBuildingInRange(state, row, ctx.tick, ctx.data);
    if (bRow < 0) continue;
    siphonFromBuildingForUnit(state, row, bRow, ctx.dt, ctx.tick, ctx.data);
  }
}
