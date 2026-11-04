import { RESOURCE_FAMILY_OF, RESOURCE_KEYS, type ResourceKey } from '@terra/contracts';
import { systemActor, treasury } from '../../economy';
import { defineCommandHandler, type CommandReject, type SimCommand } from '../../kernel/commands';
import type { StepContext } from '../../kernel/context';
import type { ColonyState, PlanetState } from '../../kernel/state';
import { ensureColonyLedger } from '../economy/ledger';
import { ensureColonyCargoState, type ColonyCargoState } from './state';
import { settleTransport } from './transport';

export interface CargoSettledCommandArgs {
  colonyId?: string;
  colonyIndex?: number;
  ref: string;
  direction?: 'export' | 'import';
  resource?: ResourceKey;
  amount?: number;
  ok: boolean;
  txHash?: string;
  error?: string;
}

function resolveSettledColonyIndex(
  state: PlanetState,
  cmd: SimCommand,
  args: Partial<CargoSettledCommandArgs>,
): number {
  if (typeof args.colonyIndex === 'number' && Number.isInteger(args.colonyIndex)) {
    return args.colonyIndex;
  }
  if (typeof args.colonyId === 'string' && args.colonyId.length > 0) {
    const match = state.colonies.find((c) => c && c.id === args.colonyId);
    if (match) return match.index;
    if (typeof cmd.colonyIndex === 'number' && Number.isInteger(cmd.colonyIndex)) {
      return cmd.colonyIndex;
    }
    return -1;
  }
  if (typeof cmd.colonyIndex === 'number' && Number.isInteger(cmd.colonyIndex)) {
    return cmd.colonyIndex;
  }
  if (typeof args.ref === 'string' && args.ref.length > 0) {
    for (const col of state.colonies) {
      if (!col) continue;
      const cargo = col.cargo as ColonyCargoState | undefined;
      if (cargo?.pendingMint?.[args.ref] || cargo?.pendingImport?.[args.ref]) {
        return col.index;
      }
    }
  }
  return 0;
}

function creditColonyStockUncapped(
  state: PlanetState,
  colony: ColonyState,
  colonyIndex: number,
  resource: ResourceKey,
  amount: number,
  reason: 'cargo.refund' | 'cargo.import',
  ref: string,
  ctx: StepContext,
): void {
  const addRes = treasury(state, ctx).add({
    colony: colonyIndex,
    amounts: { [resource]: amount },
    reason,
    actor: systemActor('cargo'),
    ref,
    clampToCap: false,
  });
  ensureColonyLedger(colony);
  if (!addRes.ok) {
    const stock = colony.stock as Record<ResourceKey, number>;
    stock[resource] = (stock[resource] ?? 0) + amount;
  }
}

function emitCargoRefunded(
  colony: ColonyState,
  colonyIndex: number,
  ref: string,
  direction: 'export' | 'import',
  resource: ResourceKey,
  amount: number,
  error: string | undefined,
  ctx: StepContext,
): void {
  const colonyIdStr = colony.id || `col-${colonyIndex}`;
  const playerId = (colony.playerId as string | undefined) ?? undefined;
  ctx.emit({
    kind: 'cargoRefunded',
    severity: 'warn',
    colonyIds: [colonyIdStr],
    data: {
      colonyId: colonyIdStr,
      colonyIndex,
      ...(playerId ? { playerId } : {}),
      ref,
      direction,
      resource,
      amount,
      ...(error ? { reason: error } : {}),
    },
  });
}

function handleExportSettled(
  state: PlanetState,
  colony: ColonyState,
  colonyIndex: number,
  cargoState: ColonyCargoState,
  args: CargoSettledCommandArgs,
  ctx: StepContext,
): string | CommandReject | void {
  const pendingExport = cargoState.pendingMint[args.ref];
  const resource = (pendingExport?.resource ?? args.resource) as ResourceKey | undefined;
  const amount = pendingExport?.amount ?? args.amount ?? 0;

  if (
    !resource ||
    !(RESOURCE_KEYS as readonly string[]).includes(resource) ||
    typeof amount !== 'number' ||
    !Number.isInteger(amount) ||
    amount <= 0
  ) {
    return 'invalid_target';
  }

  delete cargoState.pendingMint[args.ref];
  settleTransport(state, ctx, colonyIndex, cargoState, args.ref, args.ok === true);

  if (args.ok === true) {
    cargoState.inOrbit[resource] = (cargoState.inOrbit[resource] ?? 0) + amount;
    colony.changedAt = ctx.tick;
    return;
  }

  creditColonyStockUncapped(state, colony, colonyIndex, resource, amount, 'cargo.refund', args.ref, ctx);
  cargoState.lastEvent = {
    kind: 'refunded',
    direction: 'export',
    ref: args.ref,
    resource,
    amount,
    atTick: ctx.tick,
  };
  colony.changedAt = ctx.tick;
  emitCargoRefunded(colony, colonyIndex, args.ref, 'export', resource, amount, args.error, ctx);
}

function handleImportSettled(
  state: PlanetState,
  colony: ColonyState,
  colonyIndex: number,
  cargoState: ColonyCargoState,
  args: CargoSettledCommandArgs,
  ctx: StepContext,
): string | CommandReject | void {
  const pendingImport = cargoState.pendingImport[args.ref];
  const resource = (pendingImport?.resource ?? args.resource) as ResourceKey | undefined;
  const amount = pendingImport?.amount ?? args.amount ?? 0;

  if (
    !resource ||
    !(RESOURCE_KEYS as readonly string[]).includes(resource) ||
    typeof amount !== 'number' ||
    !Number.isInteger(amount) ||
    amount <= 0
  ) {
    return 'invalid_target';
  }

  delete cargoState.pendingImport[args.ref];
  settleTransport(state, ctx, colonyIndex, cargoState, args.ref, args.ok === true);
  const fam = RESOURCE_FAMILY_OF[resource];
  cargoState.reservedByFamily[fam] = Math.max(0, (cargoState.reservedByFamily[fam] ?? 0) - amount);

  if (args.ok === true) {
    creditColonyStockUncapped(state, colony, colonyIndex, resource, amount, 'cargo.import', args.ref, ctx);
    cargoState.lastEvent = {
      kind: 'imported',
      direction: 'import',
      ref: args.ref,
      resource,
      amount,
      atTick: ctx.tick,
    };
    colony.changedAt = ctx.tick;

    const colonyIdStr = colony.id || `col-${colonyIndex}`;
    const playerId = (colony.playerId as string | undefined) ?? '';
    ctx.emit({
      kind: 'cargoImported',
      severity: 'info',
      colonyIds: [colonyIdStr],
      data: {
        colonyId: colonyIdStr,
        colonyIndex,
        playerId,
        ref: args.ref,
        importSeq: pendingImport?.importSeq ?? 1,
        resource,
        amount,
        phase: 'settled',
        ...(args.txHash ? { txHash: args.txHash } : {}),
      },
    });
    return;
  }

  if ((pendingImport as { debitedInOrbit?: boolean } | undefined)?.debitedInOrbit) {
    cargoState.inOrbit[resource] = (cargoState.inOrbit[resource] ?? 0) + amount;
  }
  cargoState.lastEvent = {
    kind: 'refunded',
    direction: 'import',
    ref: args.ref,
    resource,
    amount,
    atTick: ctx.tick,
  };
  colony.changedAt = ctx.tick;
  emitCargoRefunded(colony, colonyIndex, args.ref, 'import', resource, amount, args.error, ctx);
}

export const cargoSettledHandler = defineCommandHandler({
  kind: 'cargo.settled',
  wave: 'W10',
  handle(state, cmd, ctx) {
    if (cmd.source === 'player') {
      return 'not_authorized';
    }
    const args = (cmd.args ?? {}) as Partial<CargoSettledCommandArgs>;
    if (typeof args.ref !== 'string' || args.ref.length === 0 || typeof args.ok !== 'boolean') {
      return 'invalid_args';
    }

    const colonyIndex = resolveSettledColonyIndex(state, cmd, args);
    const colony = colonyIndex >= 0 ? state.colonies[colonyIndex] : undefined;
    if (!colony) {
      return 'not_own_colony';
    }

    ensureColonyLedger(colony);
    const cargoState = ensureColonyCargoState(colony);
    const pendingExport = cargoState.pendingMint[args.ref];
    const pendingImport = cargoState.pendingImport[args.ref];
    const direction: 'export' | 'import' =
      args.direction ?? (pendingImport && !pendingExport ? 'import' : 'export');

    const settledArgs = args as CargoSettledCommandArgs;
    if (direction === 'import') {
      return handleImportSettled(state, colony, colonyIndex, cargoState, settledArgs, ctx);
    }
    return handleExportSettled(state, colony, colonyIndex, cargoState, settledArgs, ctx);
  },
});
