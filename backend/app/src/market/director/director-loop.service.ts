import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { AutoTradePartner, QuoteToken, ResourceKey } from '@terra/contracts';
import {
  directorAutoOrder,
  isDirectorTrade,
  priceDirectorOrder,
  proposeDirectorTrade,
  type DirectorPricedOrder,
  type DirectorTradeDecision,
  type DirectorTradePick,
} from '@terra/sim';
import { withinAutoTrade } from '@terra/sim/systems/away/auto-trade';
import { EventBus } from '../../bus/event-bus.js';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { FlagsService } from '../../flags/flags.service.js';
import { AgentWalletPort, type KeyStatus as WalletKey } from '../../near/application/ports/agent-wallet.port.js';
import { mirrorAmounts } from '../../near/director-key/director-key.allowance.js';
import { DirectorKeyRepository, type DirectorKeyRow } from '../../near/director-key/director-key.repository.js';
import { directorStatusFromKey } from '../../near/director-key/director-key.status.js';
import { NearException } from '../../near/domain/errors.js';
import { DirectorMarketPort, directorPlaceCommand, type DirectorFill } from './director-market.js';
import { DirectorColonySource, type DirectorColonyView, type DirectorResourceView } from './director-source.js';
import { loadDirectorTerms, type DirectorMarketTerms } from './director-terms.js';

export const DIRECTOR_LOOP_MS = 60_000;

export type DirectorLoopResult =
  | {
      readonly ok: true;
      readonly side: 'sell' | 'buy';
      readonly resource: ResourceKey;
      readonly amount: number;
      readonly spent: number;
      readonly allowance: number;
    }
  | { readonly ok: false; readonly skip: string };

const PARTNERS = new Set(['guild', 'truce', 'anyone']);

function whole(amount: string | undefined): number {
  if (!amount || !/^(0|[1-9]\d*)$/.test(amount)) return 0;
  const n = Number(amount);
  return Number.isSafeInteger(n) ? n : 0;
}

function commandIdOf(index: number, resource: string, spent: number, amount: number): string {
  const id = `d${index}-${resource}-${spent}-${amount}`;
  return id.length <= 40 ? id : id.slice(0, 40);
}

function partnerOf(partner: string): AutoTradePartner {
  return PARTNERS.has(partner) ? (partner as AutoTradePartner) : 'guild';
}

function quotePick(
  row: DirectorResourceView,
  input: DirectorResourceView['forecast'],
  pick: DirectorTradePick,
  terms: DirectorMarketTerms,
): DirectorPricedOrder | null {
  if (!input.limit || !withinAutoTrade(input.limit, directorAutoOrder(input, pick))) return null;
  return priceDirectorOrder(
    {
      resource: pick.resource,
      side: pick.side,
      amount: pick.amount,
      stock: input.stock,
      target: row.target,
      reference: row.reference,
      ownUnitCost: row.ownUnitCost,
      platformFeeBp: terms.platformFeeBp,
      maxStallFeeBp: terms.maxStallFeeBp,
      lotUnits: terms.lotUnits,
      minNotionalAtomic: terms.minNotionalAtomic,
    },
    terms.params,
  );
}

function pricedSkip(input: DirectorResourceView['forecast'], pick: DirectorTradePick): string {
  return input.limit && withinAutoTrade(input.limit, directorAutoOrder(input, pick)) ? 'no_quote' : 'autotrade_limit';
}

/**
 * Away director loop (W15-21). The sim (`proposeDirectorTrade`) picks one order; this service reserves the
 * director key, places `market.placeOrder` as the colony, and consumes the allowance only on a fill.
 * A second tick against the same stock reading does not place another order (the 600 cap still has room).
 * A spent allowance or a revoked key stops that resource and emits `directorAllowanceExhausted` once (W15-22).
 */
@Injectable()
export class DirectorLoopService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(DirectorLoopService.name);
  private readonly readings = new Map<string, number>();
  /** One exhaustion event per resource and public key. A replaced key can emit again (BE-75). */
  private readonly stopped = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private terms: DirectorMarketTerms | null | undefined;

  constructor(
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(AgentWalletPort) private readonly wallet: AgentWalletPort,
    @Inject(DirectorKeyRepository) private readonly keys: DirectorKeyRepository,
    @Inject(EventBus) private readonly bus: EventBus,
    @Inject(DirectorColonySource) private readonly source: DirectorColonySource,
    @Inject(DirectorMarketPort) private readonly market: DirectorMarketPort,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {}

  onModuleInit(): void {
    if (!this.env || this.env.NODE_ENV === 'test' || !databaseEnabled(this.env)) return;
    this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(intervalMs = DIRECTOR_LOOP_MS): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.sweep().catch((err: unknown) =>
        this.log.warn(`director sweep failed: ${err instanceof Error ? err.message : String(err)}`),
      );
    }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async sweep(): Promise<void> {
    if (!this.flags.has('W15')) return;
    for (const id of await this.source.listAway()) {
      try {
        await this.runDirectorOnce(id);
      } catch (err) {
        this.log.warn(`director ${id} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /** One colony. Does not require away: the sweep only passes away colonies, and tests call this directly. */
  async runDirectorOnce(colonyId: string): Promise<DirectorLoopResult> {
    if (!this.flags.has('W15')) return { ok: false, skip: 'wave_disabled' };
    const view = await this.source.load(colonyId);
    if (!view) return { ok: false, skip: 'no_colony' };
    if (view.rows.length === 0) return { ok: false, skip: 'no_limit' };
    const key = await this.keys.find(colonyId);
    if (!key) return { ok: false, skip: 'director_key_missing' };
    const status = await this.wallet.keyStatus({ accountId: key.accountId, publicKey: key.publicKey });
    if (status.revoked || key.revokedAt) {
      this.stopRevoked(view, key, status);
      return { ok: false, skip: 'director_key_revoked' };
    }
    return this.tradeRows(view, key, status);
  }

  private async tradeRows(
    view: DirectorColonyView,
    key: DirectorKeyRow,
    status: WalletKey,
  ): Promise<DirectorLoopResult> {
    let skip = 'no_limit';
    for (const row of view.rows) {
      const held = status.tokens.find((token) => token.token === row.forecast.resource);
      const spent = whole(held?.spent);
      const allowance = whole(held?.allowance);
      if (held && (whole(held.available) === 0 || spent >= allowance)) {
        this.noteStop(view, key, row.forecast.resource, spent, allowance, 'allowance_exhausted');
        skip = 'allowance_exhausted';
        continue;
      }
      const decision = this.decideRow(view.colonyId, row, spent);
      if (!isDirectorTrade(decision)) {
        skip = decision.skip;
        continue;
      }
      return this.placePick(view, row, key, status, decision, spent);
    }
    return { ok: false, skip };
  }

  private decideRow(colonyId: string, row: DirectorResourceView, sessionSpent: number): DirectorTradeDecision {
    const stock = row.forecast.stock;
    const id = `${colonyId}:${row.forecast.resource}`;
    const prior = this.readings.get(id);
    if (prior !== undefined && prior === stock) return { skip: 'session_cap' };
    if (prior !== undefined && prior !== stock) this.readings.delete(id);
    return proposeDirectorTrade({ ...row.forecast, stock, sessionSpent });
  }

  private async placePick(
    view: DirectorColonyView,
    row: DirectorResourceView,
    key: DirectorKeyRow,
    status: WalletKey,
    pick: DirectorTradePick,
    sessionSpent: number,
  ): Promise<DirectorLoopResult> {
    const terms = this.marketTerms();
    if (!terms) return { ok: false, skip: 'no_quote' };
    const input = { ...row.forecast, stock: row.forecast.stock, sessionSpent };
    const priced = quotePick(row, input, pick, terms);
    if (!priced) return { ok: false, skip: pricedSkip(input, pick) };
    const held = status.tokens.find((token) => token.token === priced.reserveToken);
    if (!held || BigInt(held.available) < BigInt(priced.reserveAmount))
      return { ok: false, skip: 'allowance_exhausted' };
    const commandId = commandIdOf(view.colonyIndex, pick.resource, sessionSpent, pick.amount);
    const reserved = await this.reserve(key, priced.reserveToken, priced.reserveAmount, commandId);
    if (reserved !== true) return { ok: false, skip: reserved };
    this.emitRequested(view, pick, priced.price, input.stock, sessionSpent, commandId);
    const fill = await this.market.place({
      planetId: view.planetId,
      command: directorPlaceCommand({
        colonyIndex: view.colonyIndex,
        commandId,
        side: pick.side,
        resource: pick.resource,
        amount: pick.amount,
        price: priced.price,
        ttlS: terms.ttlS,
      }),
    });
    if (fill.status !== 'filled')
      return this.afterMiss(key, priced.reserveToken, priced.reserveAmount, commandId, fill);
    return this.afterFill(view, key, pick, priced.reserveToken, priced.reserveAmount, commandId, fill, input.stock);
  }

  private async reserve(key: DirectorKeyRow, token: string, amount: string, commandId: string): Promise<true | string> {
    try {
      await this.wallet.reserveAllowance({
        opId: `dir:rsv:${commandId}`,
        accountId: key.accountId,
        publicKey: key.publicKey,
        token,
        amount,
      });
      return true;
    } catch (err) {
      if (err instanceof NearException && err.errorCode === 'NEAR_ALLOWANCE_EXHAUSTED') return 'allowance_exhausted';
      throw err;
    }
  }

  private async afterMiss(
    key: DirectorKeyRow,
    token: string,
    amount: string,
    commandId: string,
    fill: DirectorFill,
  ): Promise<DirectorLoopResult> {
    if (fill.status === 'rejected') {
      await this.wallet.releaseAllowance({
        opId: `dir:rel:${commandId}`,
        accountId: key.accountId,
        publicKey: key.publicKey,
        token,
        amount,
      });
      return { ok: false, skip: fill.code };
    }
    return { ok: false, skip: 'awaiting_fill' };
  }

  private async afterFill(
    view: DirectorColonyView,
    key: DirectorKeyRow,
    pick: DirectorTradePick,
    token: string,
    amount: string,
    commandId: string,
    fill: Extract<DirectorFill, { status: 'filled' }>,
    stock: number,
  ): Promise<DirectorLoopResult> {
    const consumed = await this.wallet.consumeAllowance({
      opId: `dir:use:${commandId}`,
      accountId: key.accountId,
      publicKey: key.publicKey,
      token,
      amount,
    });
    this.readings.set(`${view.colonyId}:${pick.resource}`, stock);
    const mirror = mirrorAmounts(consumed.status.tokens);
    await this.keys.save({
      colonyId: view.colonyId,
      accountId: key.accountId,
      publicKey: key.publicKey,
      allowance: mirror.allowance,
      spent: mirror.spent,
      tokens: consumed.status.tokens,
      revokedAt: key.revokedAt,
    });
    const row = consumed.status.tokens.find((item) => item.token === token);
    const spent = whole(row?.spent);
    const allowance = whole(row?.allowance);
    this.bus.emit('director.status', {
      planetId: view.planetId,
      playerId: view.playerId,
      colonyId: view.colonyId,
      payload: directorStatusFromKey(view.colonyId, consumed.status),
    });
    this.bus.emit('planet.event', {
      planetId: view.planetId,
      tick: view.tick,
      kind: 'directorTrade',
      severity: 'info',
      colonyIds: [view.colonyId],
      data: {
        colonyId: view.colonyId,
        colonyIndex: view.colonyIndex,
        resource: pick.resource,
        side: pick.side,
        amount: pick.amount,
        counterparty: fill.counterparty,
        tradeId: fill.tradeId,
        spent,
        allowance,
      },
    });
    if (row && (spent >= allowance || whole(row.available) === 0)) {
      this.noteStop(view, key, pick.resource, spent, allowance, 'allowance_exhausted');
    }
    return { ok: true, side: pick.side, resource: pick.resource, amount: pick.amount, spent, allowance };
  }

  /** Revoke stops every limited resource and does not place. */
  private stopRevoked(view: DirectorColonyView, key: DirectorKeyRow, status: WalletKey): void {
    for (const row of view.rows) {
      const held = status.tokens.find((token) => token.token === row.forecast.resource);
      this.noteStop(
        view,
        key,
        row.forecast.resource,
        whole(held?.spent),
        whole(held?.allowance),
        'director_key_revoked',
      );
    }
  }

  /** Emit once. A later tick with the same public key logs nothing and does not emit again. */
  private noteStop(
    view: DirectorColonyView,
    key: DirectorKeyRow,
    resource: ResourceKey,
    spent: number,
    allowance: number,
    reason: 'allowance_exhausted' | 'director_key_revoked',
  ): void {
    const id = `${key.publicKey}\0${view.colonyId}\0${resource}\0${reason}`;
    if (this.stopped.has(id)) return;
    this.stopped.add(id);
    this.log.log(`director ${view.colonyId} ${resource} skipped: ${reason}`);
    this.bus.emit('planet.event', {
      planetId: view.planetId,
      tick: view.tick,
      kind: 'directorAllowanceExhausted',
      severity: 'warn',
      colonyIds: [view.colonyId],
      data: {
        colonyId: view.colonyId,
        colonyIndex: view.colonyIndex,
        resource,
        spent,
        allowance,
        reason,
      },
    });
  }

  private emitRequested(
    view: DirectorColonyView,
    pick: DirectorTradePick,
    price: { token: QuoteToken; amount: string },
    stock: number,
    sessionSpent: number,
    commandId: string,
  ): void {
    this.bus.emit('planet.event', {
      planetId: view.planetId,
      tick: view.tick,
      kind: 'directorOrderRequested',
      severity: 'info',
      colonyIds: [view.colonyId],
      data: {
        colonyId: view.colonyId,
        colonyIndex: view.colonyIndex,
        resource: pick.resource,
        side: pick.side,
        amount: pick.amount,
        price,
        partner: partnerOf(
          view.rows.find((row) => row.forecast.resource === pick.resource)?.forecast.partner ?? 'guild',
        ),
        stock,
        sessionSpent,
        commandId,
      },
    });
  }

  private marketTerms(): DirectorMarketTerms | null {
    if (this.terms === undefined) this.terms = loadDirectorTerms(this.flags.flags);
    return this.terms;
  }
}
