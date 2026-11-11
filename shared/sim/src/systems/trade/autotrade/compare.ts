import { compareRemedies, type Remedy } from '../../../economy/flows/remedies';
import { mulRatio, ratio, type Ratio } from '../../../economy/flows/ratio';
import { buyAuthorized } from './authorize';
import type { AutoTradeForecastInput, AutoTradeRemedyRow, AutoTradeSupplyKind } from './types';

const ORDER: readonly AutoTradeSupplyKind[] = ['produce', 'buy', 'haul', 'depot', 'reserve'];

function minutesRank(row: AutoTradeRemedyRow): number {
  const m = row.minutes;
  if (!m || m.den === 0n) return Number.POSITIVE_INFINITY;
  return Number(m.num) / Number(m.den);
}

function toRow(r: Remedy, marketOk: boolean): AutoTradeRemedyRow {
  const authorized = r.available && (r.kind === 'buy' ? marketOk : true);
  return { kind: r.kind, available: r.available, authorized, minutes: r.minutes, ...(r.note ? { note: r.note } : {}) };
}

function haulRow(perUnit: Ratio | null | undefined, qty: number): AutoTradeRemedyRow {
  if (!perUnit || perUnit.den <= 0n) return { kind: 'haul', available: false, authorized: false, minutes: null, note: 'no_route' };
  return { kind: 'haul', available: true, authorized: true, minutes: mulRatio(perUnit, ratio(BigInt(qty))) };
}

function pick(rows: readonly AutoTradeRemedyRow[]): AutoTradeSupplyKind | undefined {
  const ok = rows.filter((r) => r.available && r.authorized);
  ok.sort((a, b) => minutesRank(a) - minutesRank(b) || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  return ok[0]?.kind;
}

/** Produce, buy, haul, depot and reserve for a shortage. Buy is dropped from the preference when the limit refuses it. */
export function compareSupply(input: AutoTradeForecastInput, shortage: number): { remedies: AutoTradeRemedyRow[]; preference?: AutoTradeSupplyKind } {
  const spec = input.remedies;
  const qty = Math.max(0, Math.floor(shortage));
  if (!spec || qty <= 0) return { remedies: [] };
  const marketOk = buyAuthorized(input, qty);
  const byKind = new Map(compareRemedies({
    resource: input.resource,
    qty,
    ask: spec.ask,
    localMinutesPerUnit: spec.localMinutesPerUnit,
    depot: spec.depot,
    ...(spec.logistics ? { logistics: spec.logistics } : {}),
    ...(spec.reserveLoadRelief !== undefined ? { reserveLoadRelief: spec.reserveLoadRelief } : {}),
  }).map((r) => [r.kind, r]));
  const rows: AutoTradeRemedyRow[] = [
    toRow(byKind.get('produce')!, marketOk),
    toRow(byKind.get('buy')!, marketOk),
    haulRow(spec.haulMinutesPerUnit, qty),
    toRow(byKind.get('depot')!, marketOk),
    toRow(byKind.get('reserve')!, marketOk),
  ];
  const preference = pick(rows);
  return preference ? { remedies: rows, preference } : { remedies: rows };
}
