import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { NotificationKindSchema, type NotificationKind } from '@terra/contracts';
import { EventBus, type Unsubscribe } from '../bus/event-bus.js';
import type { PlanetEventV1 } from '../bus/channels.js';
import { NotifierPort } from '../ports/notifier.port.js';
import {
  alertNotification,
  colonyTargets,
  notificationKindOf,
  notifiesTradeOffer,
  type AlertRouteInput,
} from './alert-map.js';
import { AlertToggles, UnderAttackWindow } from './alert-policy.js';

export type { AlertRouteInput } from './alert-map.js';

export interface AlertRouteResult {
  readonly sent: number;
}

/**
 * CT-36 router. Planet events arrive on `planet.event`; `rocketReady`, `truceOffered` and `trade_offer`
 * are also accepted on {@link AlertRouter.route} because those producers are later waves.
 * Nothing is filtered for a connected player here: `NotifierPort` (the mock) skips that.
 */
@Injectable()
export class AlertRouter implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('AlertRouter');
  private readonly toggles = new AlertToggles();
  private readonly attacks = new UnderAttackWindow();
  private unsub?: Unsubscribe;

  constructor(
    @Inject(NotifierPort) private readonly notifier: NotifierPort,
    @Optional() @Inject(EventBus) private readonly bus?: EventBus,
  ) {}

  onModuleInit(): void {
    if (!this.bus || this.unsub) return;
    this.unsub = this.bus.on('planet.event', (event) => this.onPlanet(event), { module: 'NotifyAlertRouter' });
  }

  onModuleDestroy(): void {
    this.unsub?.();
    this.unsub = undefined;
  }

  /** Default is on. An unknown kind is ignored. */
  setKind(colonyId: string, kind: string, on: boolean): void {
    const parsed = NotificationKindSchema.safeParse(kind);
    if (!parsed.success || colonyId.length === 0) return;
    this.toggles.set(colonyId, parsed.data, on);
  }

  async route(input: AlertRouteInput, nowMs = input.nowMs ?? Date.now()): Promise<AlertRouteResult> {
    const kind = notificationKindOf(input.kind);
    if (!kind) return { sent: 0 };
    if (kind === 'trade_offer' && !notifiesTradeOffer(input)) return { sent: 0 };
    let sent = 0;
    for (const colonyId of colonyTargets(input)) {
      if (await this.sendOne(kind, colonyId, input, nowMs)) sent += 1;
    }
    return { sent };
  }

  private onPlanet(event: PlanetEventV1): Promise<AlertRouteResult> {
    const data = isRecord(event.data) ? event.data : undefined;
    return this.route({
      kind: event.kind,
      colonyIds: event.colonyIds,
      planetId: event.planetId,
      tick: event.tick,
      data,
      eventId: `${event.kind}:${event.planetId}:${event.tick}`,
    });
  }

  private async sendOne(
    kind: NotificationKind,
    colonyId: string,
    input: AlertRouteInput,
    nowMs: number,
  ): Promise<boolean> {
    if (!this.toggles.allows(colonyId, kind)) return false;
    const note = alertNotification(kind, colonyId, input, nowMs);
    if (!note) return false;
    if (kind === 'under_attack' && !this.attacks.open(colonyId, nowMs)) return false;
    try {
      await this.notifier.send(note);
      return true;
    } catch (e) {
      this.log.error(`notify ${kind} for ${colonyId} failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
