import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { NotificationKindSchema, type NotificationKind } from '@terra/contracts';
import { EventBus, type Unsubscribe } from '../bus/event-bus.js';
import type { PlanetEventV1 } from '../bus/channels.js';
import { NotifierPort, type Notification } from '../ports/notifier.port.js';
import {
  alertNotification,
  colonyTargets,
  notificationKindOf,
  notifiesTradeOffer,
  type AlertRouteInput,
} from './alert-map.js';
import { AlertToggles, UnderAttackWindow } from './alert-policy.js';
import { FastRunAlertHold } from './fast-run-hold.js';

export type { AlertRouteInput } from './alert-map.js';

export interface AlertRouteResult {
  readonly sent: number;
}

/**
 * CT-36 router. Planet events arrive on `planet.event`; `rocketReady`, `truceOffered` and `trade_offer`
 * are also accepted on {@link AlertRouter.route} because those producers are later waves.
 * Nothing is filtered for a connected player here: `NotifierPort` (the mock) skips that.
 * A planet inside its restart fast-run buffers sends until {@link AlertRouter.flushFastRun} (CT-54).
 */
@Injectable()
export class AlertRouter implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('AlertRouter');
  private readonly toggles = new AlertToggles();
  private readonly attacks = new UnderAttackWindow();
  private readonly fastRun = new FastRunAlertHold();
  /** `colonyId` + event id already passed to `NotifierPort` for `colony_eliminated`. A later tick still sends. */
  private readonly eliminatedSent = new Set<string>();
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

  /** While set, `route` for this planet does not call `NotifierPort.send`. */
  beginFastRun(planetId: string): void {
    if (planetId.length > 0) this.fastRun.begin(planetId);
  }

  /** Sends the collapsed buffer once. An empty buffer sends nothing. */
  async flushFastRun(planetId: string, nowMs = Date.now()): Promise<AlertRouteResult> {
    let sent = 0;
    for (const note of this.fastRun.flush(planetId)) {
      if (await this.dispatch(note, nowMs)) sent += 1;
    }
    return { sent };
  }

  /** Drops the buffer without sending. Used when the catch-up stops before `fastRan`. */
  dropFastRun(planetId: string): void {
    this.fastRun.drop(planetId);
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
    const planetId = input.planetId;
    if (planetId && this.fastRun.holding(planetId)) {
      this.fastRun.push(planetId, { colonyId, kind, note });
      return false;
    }
    return this.dispatch(note, nowMs);
  }

  private async dispatch(note: Notification, nowMs: number): Promise<boolean> {
    if (note.kind === 'colony_eliminated' && !this.claimEliminated(note.colonyId, note.eventId)) return false;
    if (note.kind === 'under_attack' && !this.attacks.open(note.colonyId, nowMs)) return false;
    try {
      await this.notifier.send(note);
      return true;
    } catch (e) {
      if (note.kind === 'colony_eliminated') this.eliminatedSent.delete(eliminatedKey(note.colonyId, note.eventId));
      this.log.error(`notify ${note.kind} for ${note.colonyId} failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  /** Claimed before the port call. The bus does not await, so a second emit in the same turn must see this. */
  private claimEliminated(colonyId: string, eventId: string): boolean {
    const key = eliminatedKey(colonyId, eventId);
    if (this.eliminatedSent.has(key)) return false;
    this.eliminatedSent.add(key);
    return true;
  }
}

function eliminatedKey(colonyId: string, eventId: string): string {
  return `${colonyId}\0${eventId}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
