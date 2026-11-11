/** The consent-gated `track` of the analytics client (`ctx.services.track`). Without consent it is a no-op (CLIENT §10). */
export type TrackLike = (name: string, props?: Record<string, string | number | boolean | null>) => void;

/** Event names for Guild docks and the director (W15-26). Also `Feature.analytics`. */
export const GUILD_ANALYTICS_EVENTS = [
  'guild_docked_seen',
  'guild_offer_accepted',
  'autotrade_configured',
  'director_key_enabled',
  'director_key_revoked',
  'director_trade_executed',
] as const;

export type GuildAnalyticsEvent = (typeof GUILD_ANALYTICS_EVENTS)[number];

export interface GuildDock {
  shipId: string;
  departAt: number;
  offers?: readonly unknown[];
}

export interface ServerEventLike {
  kind: string;
  data?: Record<string, unknown>;
}

/**
 * Shared by the Guild tab, the Away autoTrade section, and the analytics feature.
 * `guild_docked_seen` is once per `shipId` + `departAt`. A `directorTrade` with a `tradeId` is once.
 * W15 off records nothing.
 */
export class GuildAnalytics {
  private readonly docks = new Set<string>();
  private readonly trades = new Set<string>();

  constructor(
    private readonly track: TrackLike | undefined,
    private readonly live: () => boolean = () => true,
  ) {}

  docked(payload: GuildDock): void {
    if (!this.live()) return;
    const key = `${payload.shipId}\0${payload.departAt}`;
    if (this.docks.has(key)) return;
    this.docks.add(key);
    this.track?.('guild_docked_seen', {
      shipId: payload.shipId,
      departAt: payload.departAt,
      offers: payload.offers?.length ?? 0,
    });
  }

  offerAccepted(offerId: string): void {
    this.emit('guild_offer_accepted', { offerId });
  }

  configured(resource: string): void {
    this.emit('autotrade_configured', { resource });
  }

  keyEnabled(): void {
    this.emit('director_key_enabled');
  }

  keyRevoked(): void {
    this.emit('director_key_revoked');
  }

  onServerEvents(events: readonly ServerEventLike[]): void {
    if (!this.live()) return;
    for (const event of events) this.noteTrade(event);
  }

  private noteTrade(event: ServerEventLike): void {
    if (event.kind !== 'directorTrade') return;
    const data = event.data ?? {};
    const amount = typeof data.amount === 'number' ? data.amount : 0;
    if (!Number.isInteger(amount) || amount <= 0) return;
    const tradeId = typeof data.tradeId === 'string' ? data.tradeId : '';
    if (tradeId) {
      if (this.trades.has(tradeId)) return;
      this.trades.add(tradeId);
    }
    const resource = typeof data.resource === 'string' ? data.resource : '';
    const side = typeof data.side === 'string' ? data.side : '';
    this.track?.(
      'director_trade_executed',
      tradeId ? { resource, side, amount, tradeId } : { resource, side, amount },
    );
  }

  private emit(name: GuildAnalyticsEvent, props?: Record<string, string | number | boolean | null>): void {
    if (!this.live()) return;
    this.track?.(name, props);
  }
}
