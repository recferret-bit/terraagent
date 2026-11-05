import { eventDef, type MarketResourceDeltas, type MarketSettledArgs } from '@terra/contracts';
import type { SimHost } from '../../host/SimHost';
import type { StepResult } from '../../kernel/step';
import type { SettleParty } from '../../systems/trade/market-parties';
import type { HarnessTrade, MarketHarness, OrderRequest } from './market-harness';

/**
 * The isolated mock of the server's market module wiring (W13-44): reads the sim's `marketOrderRequested` events, hands
 * them to the in-memory {@link MarketHarness}, and answers the same sim host with the module commands
 * `market.reserve` / `market.release` / `market.settled` (source `near`, like the real gateway), plus the mock cargo
 * port (`cargo.settled { ok: true }` for every pending export and import). The sim is `SimHost.step` unchanged.
 */
export class MarketBridge {
  private n = 0;
  /** Cargo refs already answered (a ref is settled once; the handler deletes it from the pending maps). */
  private readonly answered = new Set<string>();

  constructor(private readonly host: SimHost, private readonly harness: MarketHarness) {}

  private id(): string {
    return `m${++this.n}`;
  }

  private send(colonyId: string, colonyIndex: number | null, kind: string, args: Record<string, unknown>): void {
    this.host.submit({
      colonyIndex, source: 'near', commandId: this.id(), kind,
      args: { colonyId, ...(colonyIndex !== null ? { colonyIndex } : {}), ...args },
    });
  }

  private settleParty(t: HarnessTrade, p: SettleParty): void {
    const b = t.batch;
    const args: Omit<MarketSettledArgs, 'colonyId' | 'colonyIndex'> = {
      tradeId: b.tradeId, role: p.role, ...(p.ref ? { ref: p.ref } : {}),
      deltas: p.deltas as MarketResourceDeltas,
      ...(Object.keys(p.released).length > 0 ? { released: p.released as MarketResourceDeltas } : {}),
      trade: {
        base: b.base as MarketSettledArgs['trade']['base'], amount: Number(b.qty), quote: b.quote as MarketSettledArgs['trade']['quote'],
        notional: b.notional.toString(), platformFee: b.platformFee.toString(), stallFee: b.stallFee.toString(), stallFeeBp: b.stallFeeBp,
        makerSide: t.fill.makerSide,
      },
    };
    this.send(p.colonyId, p.colonyIndex, 'market.settled', args);
  }

  /** Answers every market event of `res`, sweeps TTL expiry at the step's tick, and settles pending cargo. */
  process(res: StepResult): void {
    for (const e of res.events) {
      if (e.kind !== 'marketOrderRequested') continue;
      const d = eventDef('marketOrderRequested').data.parse(e.data) as OrderRequest;
      const out = this.harness.handleRequested(d, e.atTick);
      if (out.rejected) {
        this.send(d.colonyId, d.colonyIndex, 'market.release', { ref: d.ref, orderId: out.order.orderId, deltas: {}, reason: 'rejected', code: out.rejected.code, detail: out.rejected.detail.slice(0, 200) });
        continue;
      }
      this.send(d.colonyId, d.colonyIndex, 'market.reserve', { ref: d.ref, orderId: out.order.orderId, deltas: out.reserve });
      for (const t of out.trades) for (const p of t.parties) this.settleParty(t, p);
    }
    for (const x of this.harness.expireDue(res.stats.tick)) {
      this.send(x.order.colonyId, x.order.colonyIndex, 'market.release', { ref: x.order.ref, orderId: x.order.orderId, deltas: x.released, reason: 'expired' });
    }
    this.settleCargo();
  }

  /** Mock NEAR cargo port: every pending mint / import is finalized `ok: true` (one answer per ref). */
  private settleCargo(): void {
    for (const col of this.host.state.colonies) {
      if (!col) continue;
      const cargo = col.cargo as { pendingMint?: Record<string, unknown>; pendingImport?: Record<string, unknown> } | undefined;
      const refs = [...Object.keys(cargo?.pendingMint ?? {}).map((r) => [r, 'export'] as const), ...Object.keys(cargo?.pendingImport ?? {}).map((r) => [r, 'import'] as const)];
      for (const [ref, direction] of refs) {
        if (this.answered.has(ref)) continue;
        this.answered.add(ref);
        this.send(col.id, col.index, 'cargo.settled', { ref, direction, ok: true });
      }
    }
  }
}
