import { createHmac } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { analyticsEvent, pairId, sanitizeAnalyticsProps, type PlaceTradeOrderRequest } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import type { Logger } from 'pino';
import { z } from 'zod';
import { APP_ENV, LOGGER, type AppEnv } from '../core/tokens';
import { PRISMA } from '../db/db.module';
import { AnalyticsCounters } from './analytics.counters';
import { PostHogClient, redactAnalyticsText, type RelayEvent } from './posthog-client';
import { tradeFailReason } from './trade-reason';

const ANON = z.uuid();

export interface ServerEvent {
  readonly name: string;
  readonly props?: Readonly<Record<string, string | number | boolean | null | undefined>>;
  readonly anonId?: string;
  readonly playerId?: string;
}

function header(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** A catalog `wallet_kind`, else `other`. A missing header uses `whenMissing` (`none` on social, `other` on near-wallet). */
export function walletKind(raw: string | undefined, whenMissing: 'none' | 'other'): string {
  const candidate = raw === undefined || raw.trim() === '' ? whenMissing : raw.trim();
  const clean = sanitizeAnalyticsProps('auth_completed', { method: 'google', wallet_kind: candidate });
  return clean.wallet_kind === candidate ? candidate : 'other';
}

function anonIdOf(value: string | undefined): string | undefined {
  return value && ANON.safeParse(value).success ? value : undefined;
}

function personDistinctId(playerId: string, salt: string): string {
  return createHmac('sha256', salt).update(playerId).digest('hex').slice(0, 32);
}

function saltOf(env: AppEnv | undefined): string | undefined {
  const value = env?.POSTHOG_PERSON_SALT;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function label(value: string | number | boolean | undefined): string {
  return typeof value === 'string' && value.length > 0 ? value : 'unknown';
}

/** `buy` / `sell` only. `sanitizeAnalyticsProps` turns `base/quote` into `base-quote`. */
function tradeProps(order: PlaceTradeOrderRequest): Record<string, string> {
  const props: Record<string, string> = { pair: pairId(order.resource, order.price.token) };
  if (order.side === 'buy' || order.side === 'sell') props.side = order.side;
  return props;
}

function placeStatus(outcome: unknown): 'accepted' | 'pending' | 'rejected' | undefined {
  if (!outcome || typeof outcome !== 'object') return undefined;
  const status = (outcome as { status?: unknown }).status;
  return status === 'accepted' || status === 'pending' || status === 'rejected' ? status : undefined;
}

function codeOf(outcome: unknown): string | undefined {
  if (!outcome || typeof outcome !== 'object') return undefined;
  const row = outcome as { error?: { code?: unknown }; code?: unknown; errorCode?: unknown };
  if (typeof row.error?.code === 'string') return row.error.code;
  if (typeof row.code === 'string') return row.code;
  if (typeof row.errorCode === 'string') return row.errorCode;
  return undefined;
}

function identify(anonId: string, distinctId: string, props: Record<string, string | number | boolean>): RelayEvent {
  const set: Record<string, string> = {};
  if (typeof props.method === 'string') set.auth_method = props.method;
  if (typeof props.wallet_kind === 'string') set.wallet_kind = props.wallet_kind;
  return { event: '$identify', distinctId, timestamp: new Date().toISOString(), properties: { $anon_distinct_id: anonId, $set: set } };
}

/** Server commits (`auth_completed`, trade). Counters always; a row and PostHog only for a consented anon id. */
@Injectable()
export class ProductRecorder {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly counters: AnalyticsCounters,
    private readonly posthog: PostHogClient,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() @Inject(LOGGER) private readonly log?: Logger,
  ) {}

  async recordServerEvent(input: ServerEvent): Promise<void> {
    try {
      await this.write(input);
    } catch (error) {
      this.warn(error);
    }
  }

  /** One call from social login and near verify. Does not log the player id. A thrown login never reaches here. */
  recordAuthCompleted(req: IncomingMessage, method: string, playerId: string): Promise<void> {
    const whenMissing = method === 'near-wallet' ? 'other' : 'none';
    return this.recordServerEvent({
      name: 'auth_completed',
      playerId,
      anonId: anonIdOf(header(req, 'x-terra-anon')),
      props: { method, wallet_kind: walletKind(header(req, 'x-terra-wallet'), whenMissing) },
    });
  }

  /** Place only. Pending is not a commit. Cancel and the in-game sim market do not call this. */
  async recordTradePlace(req: IncomingMessage, order: PlaceTradeOrderRequest, outcome: unknown): Promise<void> {
    try {
      const anonId = anonIdOf(header(req, 'x-terra-anon'));
      const props = tradeProps(order);
      const status = placeStatus(outcome);
      if (status === 'pending') return;
      if (status === 'accepted') {
        await this.recordServerEvent({ name: 'trade_order_accepted', anonId, props });
        return;
      }
      await this.recordServerEvent({
        name: 'trade_order_failed',
        anonId,
        props: { ...props, source: 'server', reason: tradeFailReason(codeOf(outcome)) },
      });
    } catch (error) {
      this.warn(error);
    }
  }

  private async write(input: ServerEvent): Promise<void> {
    if (this.env?.ANALYTICS_DISABLED === true || !analyticsEvent(input.name)) return;
    const props = sanitizeAnalyticsProps(input.name, input.props ?? {});
    this.count(input.name, props);
    const anonId = anonIdOf(input.anonId);
    if (!anonId) return;
    try {
      await this.store(input.name, anonId, props);
    } catch (error) {
      this.warn(error);
    }
    await this.forward(input, props, anonId);
  }

  private count(name: string, props: Record<string, string | number | boolean>): void {
    this.counters.count('ta_product_events_total', { name });
    if (name === 'auth_completed') {
      this.counters.count('ta_auth_completed_total', { method: label(props.method), wallet_kind: label(props.wallet_kind) });
    }
    if (name === 'trade_order_accepted' || name === 'trade_order_failed') {
      this.counters.count('ta_trade_orders_total', { result: name === 'trade_order_accepted' ? 'accepted' : 'failed' });
    }
  }

  private store(name: string, anonId: string, props: Record<string, string | number | boolean>): Promise<unknown> {
    return this.prisma.analyticsEvent.create({ data: { name, ts: new Date(), anonId, sessionId: 'server', props } });
  }

  /** `$identify` uses the hmac person. The commit itself keeps the anon id so one browser still joins without a salt. */
  private forward(input: ServerEvent, props: Record<string, string | number | boolean>, anonId: string): Promise<void> {
    const events: RelayEvent[] = [];
    const salt = saltOf(this.env);
    const player = input.playerId?.trim();
    if (salt && player) events.push(identify(anonId, personDistinctId(player, salt), props));
    events.push({
      event: input.name,
      distinctId: anonId,
      timestamp: new Date().toISOString(),
      properties: { ...props, $process_person_profile: false, $lib: 'terra-relay' },
    });
    return this.posthog.send(events);
  }

  private warn(error: unknown): void {
    const raw = error instanceof Error ? error.message : 'analytics record failed';
    const secret = typeof this.env?.POSTHOG_KEY === 'string' ? this.env.POSTHOG_KEY : undefined;
    this.log?.warn({ err: redactAnalyticsText(raw, secret) }, 'analytics record failed');
  }
}
