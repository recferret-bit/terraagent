import type { ResourceKey } from '@terra/contracts';
import { colonyActor, getColonyStock, treasury, treasuryCtx, type Amounts } from '../../economy';
import type { CommandReject } from '../../kernel/commands';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { transportRow } from '../prestige/rows';
import type { ColonyCargoState } from './state';

/**
 * The metered cargo transport recipe (W13-43, ECONOMY §3): a cargo export or import is a service that costs
 * `ceil(units / unitsPerBlock)` blocks of the `prestige.transport.cargo` inputs. The inputs are reserved (withdrawn to
 * `sys:transport`, reason `transport.reserve`) when the operation is accepted, kept when it settles OK (the service
 * ran), and returned (`transport.release`) when it fails before service. The reservation is keyed by the operation ref,
 * which exists once per operation, so a retried mint or burn settlement never charges again. With W13 off the rows do
 * not exist and every function here is a no-op: export and import behave exactly as before.
 */

/** The inputs a service of `units` costs, or `null` when W13 is off. */
export function transportCharge(units: number, data?: StepContext['data']): Amounts | null {
  const row = transportRow(data);
  if (!row || units <= 0) return null;
  const blocks = Math.ceil(units / row.unitsPerBlock);
  const out: Amounts = {};
  for (const [k, v] of Object.entries(row.cost) as [ResourceKey, number][]) if (v > 0) out[k] = v * blocks;
  return out;
}

/**
 * Rejects `insufficient_resources` when the colony cannot pay the charge of a `units` service (`alsoTaking` is what the
 * operation itself withdraws from stock, so the same resource is not counted twice). `undefined` when it can, or W13 is off.
 */
export function checkTransportAffordable(
  state: PlanetState,
  colonyIndex: number,
  units: number,
  data: StepContext['data'] | undefined,
  alsoTaking?: { resource: ResourceKey; amount: number },
): CommandReject | undefined {
  const charge = transportCharge(units, data);
  if (!charge) return undefined;
  const stock = getColonyStock(state, colonyIndex);
  for (const [k, v] of Object.entries(charge) as [ResourceKey, number][]) {
    const need = v + (alsoTaking?.resource === k ? alsoTaking.amount : 0);
    if (stock[k] < need) return { code: 'insufficient_resources', detail: `Transport needs ${v} ${k} for ${units} units.` };
  }
  return undefined;
}

/** Reserves the service inputs for operation `ref` (once: a second call for the same ref changes nothing). */
export function reserveTransport(
  state: PlanetState,
  ctx: StepContext,
  colonyIndex: number,
  cargo: ColonyCargoState,
  ref: string,
  units: number,
): void {
  const charge = transportCharge(units, ctx.data);
  if (!charge || cargo.transportReserve[ref]) return;
  const res = treasury(state, treasuryCtx(ctx.tick, ctx)).withdraw({
    colony: colonyIndex, amounts: charge, reason: 'transport.reserve', actor: colonyActor(state, colonyIndex), ref,
  });
  if (res.ok) cargo.transportReserve[ref] = charge; // else: unreachable after `checkTransportAffordable`; nothing is charged
}

/** The service ran: the reservation becomes the charge (it stays in `sys:transport`). */
export function finalizeTransport(cargo: ColonyCargoState, ref: string): void {
  delete cargo.transportReserve[ref];
}

/** The operation failed before service: the reserved inputs go back to the colony, uncapped. */
export function releaseTransport(state: PlanetState, ctx: StepContext, colonyIndex: number, cargo: ColonyCargoState, ref: string): void {
  const held = cargo.transportReserve[ref];
  if (!held) return;
  delete cargo.transportReserve[ref];
  treasury(state, treasuryCtx(ctx.tick, ctx)).add({
    colony: colonyIndex, amounts: held, reason: 'transport.release', actor: colonyActor(state, colonyIndex), ref, clampToCap: false,
  });
}

/** Settles the reservation of `ref` by the outcome of its operation. */
export function settleTransport(state: PlanetState, ctx: StepContext, colonyIndex: number, cargo: ColonyCargoState, ref: string, ok: boolean): void {
  if (ok) finalizeTransport(cargo, ref);
  else releaseTransport(state, ctx, colonyIndex, cargo, ref);
}
