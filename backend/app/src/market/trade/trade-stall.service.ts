import { Inject, Injectable } from '@nestjs/common';
import type { PutTradeStallRequest, SimCommandV1, TradeStallResponse } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { PRISMA } from '../../db/db.module.js';
import { MarketPolicyProvider } from '../orders/market-policy.provider.js';
import { IntentTradeRepository } from '../settlement/intent-trade.repository.js';
import { TradeAuth, type TradePrincipal } from './trade-auth.js';
import { TradeError } from './trade-error.js';
import { TradeOrdersService } from './trade-orders.service.js';
import { TradeSimPort } from './trade-sim.port.js';

/**
 * The caller's Trade Hub stall (`GET|PUT /v1/trade/stall`). PUT sends the same sim `market.setHubFee` command as the game socket, as the
 * caller's colony; the sim owns the rules (Trade Hub present, policy range) and the market module stores the `marketHubFeeSet` event.
 * Humans only: the sim refuses `source: 'bot'` for this command, so API keys get `forbidden_scope` up front.
 */
/** How long an accepted PUT is shown before the stored value (written by the sim's `marketHubFeeSet` event) must have caught up. */
const PENDING_FEE_TTL_MS = 15_000;

@Injectable()
export class TradeStallService {
  /** Read-your-write: the fee the sim accepted but the store may not hold yet, per planet and colony. */
  private readonly pending = new Map<string, { bp: number; at: number }>();

  constructor(
    private readonly orders: TradeOrdersService,
    private readonly sim: TradeSimPort,
    private readonly policy: MarketPolicyProvider,
    private readonly trades: IntentTradeRepository,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  private async colonyOf(p: TradePrincipal, planetId: string | undefined) {
    this.orders.gate();
    if (p.key) throw new TradeError('forbidden_scope', 'Stall fees are set by the owner session, not by an API key.', { scope: 'manage', reason: 'session_only' });
    TradeAuth.require(p, 'manage');
    const id = this.orders.planetOf(p, planetId);
    return { planetId: id, colony: await this.orders.colonyOrThrow(p, id) };
  }

  async get(p: TradePrincipal, planetId: string | undefined): Promise<TradeStallResponse> {
    const { planetId: id, colony } = await this.colonyOf(p, planetId);
    const cfg = this.policy.current();
    const stall = await this.prisma.marketStall.findUnique({ where: { planetId_colonyId: { planetId: id, colonyId: colony.colonyId } }, select: { feeBp: true } });
    const key = `${id}|${colony.colonyId}`;
    const pend = this.pending.get(key);
    if (pend && (stall?.feeBp === pend.bp || Date.now() - pend.at > PENDING_FEE_TTL_MS)) this.pending.delete(key); // the store caught up (or the event never came)
    const shown = pend && this.pending.has(key) ? pend.bp : undefined;
    return {
      planetId: id, hubFeeBp: shown ?? stall?.feeBp ?? cfg.stallFeeDefaultBp, minBp: cfg.stallFeeMinBp, maxBp: cfg.stallFeeMaxBp, defaultBp: cfg.stallFeeDefaultBp,
      earned: await this.trades.stallEarned(id, colony.colonyId),
    };
  }

  async set(p: TradePrincipal, body: PutTradeStallRequest): Promise<TradeStallResponse> {
    const { planetId, colony } = await this.colonyOf(p, body.planetId);
    const cfg = this.policy.current();
    if (body.bp < cfg.stallFeeMinBp || body.bp > cfg.stallFeeMaxBp) {
      throw new TradeError('fee_out_of_range', `Stall fee must be within ${cfg.stallFeeMinBp}..${cfg.stallFeeMaxBp} bp.`, { minBp: cfg.stallFeeMinBp, maxBp: cfg.stallFeeMaxBp });
    }
    const cmd: SimCommandV1 = { colonyIndex: colony.colonyIndex, source: 'player', commandId: `stall:${planetId}:${colony.colonyId}:${Date.now()}`, kind: 'market.setHubFee', args: { bp: body.bp } };
    let out: Awaited<ReturnType<TradeSimPort['submit']>>;
    try {
      out = await this.sim.submit(planetId, cmd);
    } catch (err) {
      throw new TradeError('host_unavailable', err instanceof Error ? err.message : String(err), undefined, 503);
    }
    if (!out.ok) throw new TradeError(String(out.code), 'detail' in out && out.detail ? String(out.detail) : String(out.code));
    this.pending.set(`${planetId}|${colony.colonyId}`, { bp: body.bp, at: Date.now() });
    return this.get(p, planetId);
  }
}
