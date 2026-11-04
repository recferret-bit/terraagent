import type { ResourceFamily, ResourceKey } from '@terra/contracts';
import { systemActor } from '../../economy/accounts';
import type { LedgerReason } from '../../economy/reasons';
import { splitMicro, valueMicro } from '../../economy/residual';
import { treasury, treasuryCtx, unrecorded, type TreasuryCtx } from '../../economy/treasury';
import { activeLedgerSink } from '../../kernel/ledgerSink';
import type { PlanetState } from '../../kernel/state';
import type { ColonyWithLedger } from './ledger';

/** Where a colony's whole-unit changes are made and recorded: the running step's, else a throwaway (nothing recorded). */
function hostOf(colony: ColonyWithLedger, tick: number): { state: PlanetState; ctx: TreasuryCtx } {
  const sink = activeLedgerSink();
  if (sink && sink.state.colonies[colony.index] === colony) return { state: sink.state, ctx: treasuryCtx(sink.ctx.tick, sink.ctx) };
  const colonies: unknown[] = [];
  colonies[colony.index] = colony; // the treasury reads only this record (and `meta.tick` through setStock, unused here)
  return { state: { colonies, meta: { tick } } as unknown as PlanetState, ctx: unrecorded(tick) };
}

/** Room per family that incoming cargo imports have reserved (`col.cargo.reservedByFamily`, whole units). */
function reservedRoom(colony: ColonyWithLedger): Partial<Record<ResourceFamily, number>> {
  const r = (colony.cargo as { reservedByFamily?: Partial<Record<ResourceFamily, number>> } | undefined)?.reservedByFamily ?? {};
  return { metals: Number(r.metals ?? 0), minerals: Number(r.minerals ?? 0), bio: Number(r.bio ?? 0) };
}

export interface MoveOutcome {
  /** Whole units that reached `col.stock`. */
  credited: number;
  /** Whole units that did not fit under the family cap (lost, posted to `sys:overflow`). */
  capped: number;
}

/**
 * Adds `deltaMicro` (signed, integer micro-units) to the exact value of `key` and re-splits it (see `economy/residual`):
 * the whole-unit change goes through `ColonyTreasury` (credits `clampToCap` under the family cap less reserved import
 * room, debits are all-or-nothing and cannot fail because `col.stock` is the floor of the value), the sub-unit rest
 * stays in `col.residual[key]` whatever the cap did. A value below zero is clamped to zero (callers check
 * affordability first). Not for use outside `systems/economy`: callers use `creditResource` and friends.
 */
export function moveMicro(
  colony: ColonyWithLedger,
  key: ResourceKey,
  deltaMicro: number,
  tick: number,
  reason: LedgerReason,
): MoveOutcome {
  const stock = colony.stock[key];
  const next = splitMicro(Math.max(0, valueMicro(stock, colony.residual[key]) + deltaMicro));
  const whole = next.stock - stock;
  const out: MoveOutcome = { credited: 0, capped: 0 };
  colony.residual[key] = next.residual;
  if (whole === 0) return out;
  const { state, ctx } = hostOf(colony, tick);
  const base = { colony: colony.index, amounts: { [key]: Math.abs(whole) }, reason, actor: systemActor('economy') };
  if (whole > 0) {
    const res = treasury(state, ctx).add({ ...base, clampToCap: true, reserved: reservedRoom(colony) });
    if (res.ok) {
      out.credited = res.credited[key] ?? 0;
      out.capped = res.overflow[key] ?? 0;
    } else {
      out.capped = whole; // unreachable for a valid key/reason; never writes a half-validated balance
    }
  } else {
    treasury(state, ctx).withdraw(base); // cannot be refused: the stock covers the floor of a non-negative value
  }
  return out;
}
