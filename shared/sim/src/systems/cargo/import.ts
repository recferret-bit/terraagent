import {
  RESOURCE_FAMILY_OF,
  RESOURCE_KEYS,
  cargoImportOpId,
  type ResourceKey,
} from '@terra/contracts';
import { colonyActor, getColonyCaps, treasury, treasuryCtx } from '../../economy';
import { defineCommandHandler, type CommandReject, type SimCommand } from '../../kernel/commands';
import type { StepContext } from '../../kernel/context';
import type { ColonyState, PlanetState } from '../../kernel/state';
import { ensureColonyLedger, remainingFamilyCap } from '../economy/ledger';
import { ensureColonyCargoState, type ColonyCargoState } from './state';
import { getColonyTradeHubStatus, recordColonyTradeHubTransfer } from './trade-hub';

export interface CargoImportCommandArgs {
  colonyId?: string;
  colonyIndex?: number;
  resource: ResourceKey;
  amount: number;
}

function resolveImportColonyIndex(
  state: PlanetState,
  cmd: SimCommand,
  args: Partial<CargoImportCommandArgs>,
): number {
  if (typeof cmd.colonyIndex === 'number' && Number.isInteger(cmd.colonyIndex)) {
    return cmd.colonyIndex;
  }
  if (typeof args.colonyIndex === 'number' && Number.isInteger(args.colonyIndex)) {
    return args.colonyIndex;
  }
  if (typeof args.colonyId === 'string' && args.colonyId.length > 0) {
    const match = state.colonies.find((c) => c && c.id === args.colonyId);
    return match ? match.index : -1;
  }
  return 0;
}

function validateColonyOwnership(
  colony: ColonyState | undefined,
  cmd: SimCommand,
  args: Partial<CargoImportCommandArgs>,
): CommandReject | undefined {
  if (!colony || colony.status === 'eliminated') {
    return { code: 'not_own_colony', detail: 'Cannot import into another player colony.' };
  }
  if (
    typeof args.colonyId === 'string' &&
    args.colonyId.length > 0 &&
    colony.id &&
    args.colonyId !== colony.id
  ) {
    return { code: 'not_own_colony', detail: 'Cannot import into another player colony.' };
  }
  const cmdPlayerId = (cmd as { playerId?: string }).playerId;
  if (cmdPlayerId && colony.playerId && cmdPlayerId !== colony.playerId) {
    return { code: 'not_own_colony', detail: 'Cannot import into another player colony.' };
  }
  return undefined;
}

function applyCargoImportRequest(
  state: PlanetState,
  colony: ColonyState,
  colonyIndex: number,
  cargoState: ColonyCargoState,
  resource: ResourceKey,
  requestedAmount: number,
  clampedAmount: number,
  debitedInOrbit: boolean,
  cmdPlayerId: string | undefined,
  ctx: StepContext,
): void {
  const family = RESOURCE_FAMILY_OF[resource];
  cargoState.reservedByFamily[family] = (cargoState.reservedByFamily[family] ?? 0) + clampedAmount;

  const colonyIdStr = colony.id || `col-${colonyIndex}`;
  const importSeq = cargoState.importSeq + 1;
  const ref = cargoImportOpId(colonyIdStr, importSeq);

  cargoState.importSeq = importSeq;
  cargoState.pendingImport[ref] = {
    ref,
    importSeq,
    resource,
    amount: clampedAmount,
    requestedAmount,
    debitedInOrbit,
    atTick: ctx.tick,
  };

  recordColonyTradeHubTransfer(state, colonyIndex, clampedAmount, ctx.tick, ctx.data);
  colony.changedAt = ctx.tick;

  const playerId = (colony.playerId as string | undefined) ?? cmdPlayerId ?? '';
  ctx.emit({
    kind: 'cargoImported',
    severity: 'info',
    colonyIds: [colonyIdStr],
    data: {
      colonyId: colonyIdStr,
      colonyIndex,
      playerId,
      ref,
      importSeq,
      resource,
      amount: clampedAmount,
      phase: 'requested',
    },
  });
}

function finalizeCargoImportSuccess(
  state: PlanetState,
  colony: ColonyState,
  colonyIndex: number,
  cargoState: ColonyCargoState,
  ref: string,
  importSeq: number,
  resource: ResourceKey,
  amount: number,
  tick: number,
  ctx: StepContext,
  txHash?: string,
): void {
  const addRes = treasury(state, treasuryCtx(tick, ctx)).add({
    colony: colonyIndex,
    amounts: { [resource]: amount },
    reason: 'cargo.import',
    actor: colonyActor(state, colonyIndex),
    ref,
  });
  if (!addRes.ok) {
    const ledgerCol = ensureColonyLedger(colony);
    ledgerCol.stock[resource] = (ledgerCol.stock[resource] ?? 0) + amount;
  }
  ensureColonyLedger(colony);
  cargoState.lastEvent = {
    kind: 'imported',
    direction: 'import',
    ref,
    resource,
    amount,
    atTick: tick,
  };
  colony.changedAt = tick;
  const colonyIdStr = colony.id || `col-${colonyIndex}`;
  const playerId = (colony.playerId as string | undefined) ?? '';
  ctx?.emit?.({
    kind: 'cargoImported',
    severity: 'info',
    colonyIds: [colonyIdStr],
    data: {
      colonyId: colonyIdStr,
      colonyIndex,
      playerId,
      ref,
      importSeq,
      resource,
      amount,
      phase: 'settled',
      ...(txHash ? { txHash } : {}),
    },
  });
}

/**
 * Settles a pending cargo import identified by `ref`.
 * - On `ok: true`, releases the incoming family reservation, credits `pending.amount` into `colony.stock`,
 *   and emits `cargoImported` with `phase: 'settled'`.
 * - On `ok: false`, releases the incoming family reservation without crediting `colony.stock`
 *   (restoring `inOrbit` if it was debited at request time) and emits `cargoRefunded`.
 */
export function settleCargoImport(
  state: PlanetState,
  colonyIndex: number,
  ref: string,
  ok: boolean,
  ctx: StepContext,
  _error?: string,
  txHash?: string,
): boolean {
  const colony = state.colonies[colonyIndex];
  if (!colony) return false;

  ensureColonyLedger(colony);
  const cargoState = ensureColonyCargoState(colony);
  const pending = cargoState.pendingImport[ref];
  if (!pending) return false;

  const family = RESOURCE_FAMILY_OF[pending.resource];
  const prevReserved = cargoState.reservedByFamily[family] ?? 0;
  cargoState.reservedByFamily[family] = Math.max(0, prevReserved - pending.amount);
  delete cargoState.pendingImport[ref];

  const tick = ctx?.tick ?? state.meta.tick;
  if (ok) {
    finalizeCargoImportSuccess(
      state,
      colony,
      colonyIndex,
      cargoState,
      ref,
      pending.importSeq,
      pending.resource,
      pending.amount,
      tick,
      ctx,
      txHash,
    );
    return true;
  }

  if (pending.debitedInOrbit) {
    cargoState.inOrbit[pending.resource] =
      (cargoState.inOrbit[pending.resource] ?? 0) + pending.amount;
  }
  cargoState.lastEvent = {
    kind: 'refunded',
    direction: 'import',
    ref,
    resource: pending.resource,
    amount: pending.amount,
    atTick: tick,
  };
  colony.changedAt = tick;
  const colonyIdStr = colony.id || `col-${colonyIndex}`;
  const playerId = (colony.playerId as string | undefined) ?? '';
  ctx?.emit?.({
    kind: 'cargoRefunded',
    severity: 'warn',
    colonyIds: [colonyIdStr],
    data: {
      colonyId: colonyIdStr,
      colonyIndex,
      playerId,
      ref,
      direction: 'import',
      resource: pending.resource,
      amount: pending.amount,
    },
  });
  return true;
}

export const cargoImportHandler = defineCommandHandler({
  kind: 'cargo.import',
  wave: 'W10',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as Partial<CargoImportCommandArgs>;
    const colonyIndex = resolveImportColonyIndex(state, cmd, args);
    const colony = colonyIndex >= 0 ? state.colonies[colonyIndex] : undefined;

    const ownerReject = validateColonyOwnership(colony, cmd, args);
    if (ownerReject || !colony) return ownerReject ?? 'not_own_colony';

    const { resource, amount } = args;
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
      return 'invalid_target';
    }
    if (typeof resource !== 'string' || !(RESOURCE_KEYS as readonly string[]).includes(resource)) {
      return 'invalid_args';
    }

    const hubStatus = getColonyTradeHubStatus(state, colonyIndex, ctx.data, ctx.tick);
    if (hubStatus.hubCount === 0) {
      return { code: 'no_trade_hub', detail: 'Build a Trade Hub to move cargo to orbit.' };
    }
    if (!hubStatus.anyOnline) {
      return { code: 'hub_offline', detail: 'Trade Hub is unpowered.' };
    }

    if (!colony.caps) {
      const initial = getColonyCaps(state, colonyIndex, ctx.data);
      colony.caps = { metals: initial.metals, minerals: initial.minerals, bio: initial.bio };
    }
    ensureColonyLedger(colony);
    const cargoState = ensureColonyCargoState(colony);

    const family = RESOURCE_FAMILY_OF[resource];
    const freeStorage = Math.floor(remainingFamilyCap(colony, family));
    if (freeStorage <= 0) {
      return { code: 'storage_full', detail: 'Storage is full — build a Supply Depot or free space.' };
    }

    const clampedAmount = Math.min(amount, freeStorage);

    let debitedInOrbit = false;
    const inOrbitBal = cargoState.inOrbit[resource];
    if (typeof inOrbitBal === 'number') {
      if (inOrbitBal <= 0 || inOrbitBal < clampedAmount) {
        return { code: 'insufficient_cargo', detail: 'Not enough in orbit.' };
      }
      cargoState.inOrbit[resource] = inOrbitBal - clampedAmount;
      debitedInOrbit = true;
    }

    const cmdPlayerId = (cmd as { playerId?: string }).playerId;
    applyCargoImportRequest(
      state,
      colony,
      colonyIndex,
      cargoState,
      resource,
      amount,
      clampedAmount,
      debitedInOrbit,
      cmdPlayerId,
      ctx,
    );
  },
});
