import { RESOURCE_KEYS, cargoExportOpId, type ResourceKey } from '@terra/contracts';
import { colonyActor, getColonyStock, treasury } from '../../economy';
import { defineCommandHandler, type CommandReject, type SimCommand } from '../../kernel/commands';
import type { StepContext } from '../../kernel/context';
import type { ColonyState, PlanetState } from '../../kernel/state';
import { ensureColonyLedger } from '../economy/ledger';
import {
  checkCargoMintCaps,
  computeCargoUtcDay,
  computeSecondsUntilUtcMidnight,
  recordCargoMint,
  resolveDailyCargoMintCap,
} from './caps';
import { ensureColonyCargoState, type ColonyCargoState } from './state';
import { getColonyTradeHubStatus, recordColonyTradeHubTransfer } from './trade-hub';

export interface CargoExportCommandArgs {
  colonyId?: string;
  colonyIndex?: number;
  resource: ResourceKey;
  amount: number;
  utcDay?: number | string;
}

function resolveExportColonyIndex(
  state: PlanetState,
  cmd: SimCommand,
  args: Partial<CargoExportCommandArgs>,
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

function resolveEffectiveUtcDay(
  state: PlanetState,
  cargoState: ColonyCargoState,
  argUtcDay: number | string | undefined,
  tick: number,
): number | string {
  if (argUtcDay !== undefined) {
    return argUtcDay;
  }
  if (typeof cargoState.currentUtcDay === 'string' && cargoState.currentUtcDay !== '1970-01-01') {
    return cargoState.currentUtcDay;
  }
  const clockDay = computeCargoUtcDay({ tick, state });
  if (typeof cargoState.utcDay === 'number' && cargoState.utcDay > 0) {
    return Math.max(cargoState.utcDay, clockDay);
  }
  return clockDay;
}

function validateColonyOwnership(
  colony: ColonyState | undefined,
  cmd: SimCommand,
  args: Partial<CargoExportCommandArgs>,
): CommandReject | undefined {
  if (!colony || colony.status === 'eliminated') {
    return { code: 'not_own_colony', detail: 'Cannot export from another player colony.' };
  }
  if (
    typeof args.colonyId === 'string' &&
    args.colonyId.length > 0 &&
    colony.id &&
    args.colonyId !== colony.id
  ) {
    return { code: 'not_own_colony', detail: 'Cannot export from another player colony.' };
  }
  const cmdPlayerId = (cmd as { playerId?: string }).playerId;
  if (cmdPlayerId && colony.playerId && cmdPlayerId !== colony.playerId) {
    return { code: 'not_own_colony', detail: 'Cannot export from another player colony.' };
  }
  return undefined;
}

function applyCargoExport(
  state: PlanetState,
  colony: ColonyState,
  colonyIndex: number,
  cargoState: ColonyCargoState,
  resource: ResourceKey,
  amount: number,
  effectiveUtcDay: number | string,
  cmdPlayerId: string | undefined,
  ctx: StepContext,
): CommandReject | undefined {
  const colonyIdStr = colony.id || `col-${colonyIndex}`;
  const exportSeq = cargoState.exportSeq + 1;
  const ref = cargoExportOpId(colonyIdStr, exportSeq);

  ensureColonyLedger(colony);
  const withdrawRes = treasury(state, ctx).withdraw({
    colony: colonyIndex,
    amounts: { [resource]: amount },
    reason: 'cargo.export',
    actor: colonyActor(state, colonyIndex),
    ref,
  });
  if (!withdrawRes.ok) {
    return { code: 'insufficient_stock', detail: 'Not enough in colony storage.' };
  }
  ensureColonyLedger(colony);

  cargoState.exportSeq = exportSeq;
  cargoState.pendingMint[ref] = { ref, exportSeq, resource, amount, atTick: ctx.tick };
  cargoState.lastEvent = {
    kind: 'exported',
    direction: 'export',
    ref,
    resource,
    amount,
    atTick: ctx.tick,
  };
  recordCargoMint(cargoState, amount, resource, ctx.tick, effectiveUtcDay);
  recordColonyTradeHubTransfer(state, colonyIndex, amount, ctx.tick, ctx.data);
  colony.changedAt = ctx.tick;

  const playerId = (colony.playerId as string | undefined) ?? cmdPlayerId ?? '';
  ctx.emit({
    kind: 'cargoExported',
    severity: 'info',
    colonyIds: [colonyIdStr],
    data: { colonyId: colonyIdStr, colonyIndex, playerId, ref, exportSeq, resource, amount },
  });
  return undefined;
}

export const cargoExportHandler = defineCommandHandler({
  kind: 'cargo.export',
  wave: 'W10',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as Partial<CargoExportCommandArgs>;
    const colonyIndex = resolveExportColonyIndex(state, cmd, args);
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

    const stock = getColonyStock(state, colonyIndex);
    if ((stock[resource] ?? 0) < amount) {
      return { code: 'insufficient_stock', detail: 'Not enough in colony storage.' };
    }

    const cargoState = ensureColonyCargoState(colony);
    const effectiveUtcDay = resolveEffectiveUtcDay(state, cargoState, args.utcDay, ctx.tick);
    const capCheck = checkCargoMintCaps({
      capState: cargoState,
      amount,
      resource,
      currentTick: ctx.tick,
      onlineThroughputPerMin: hubStatus.totalOnlineThroughputPerMin,
      dailyCap: resolveDailyCargoMintCap(ctx.data, cargoState),
      currentUtcDay: effectiveUtcDay,
      secondsUntilUtcMidnight: computeSecondsUntilUtcMidnight({ tick: ctx.tick, state }),
    });
    if (!capCheck.ok) {
      return { code: 'mint_cap', detail: capCheck.detail };
    }

    const cmdPlayerId = (cmd as { playerId?: string }).playerId;
    return applyCargoExport(
      state,
      colony,
      colonyIndex,
      cargoState,
      resource,
      amount,
      effectiveUtcDay,
      cmdPlayerId,
      ctx,
    );
  },
});
