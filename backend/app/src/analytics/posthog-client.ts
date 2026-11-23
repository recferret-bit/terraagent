import { Inject, Injectable, Optional } from '@nestjs/common';
import { analyticsEvent, sanitizeAnalyticsProps } from '@terra/contracts';
import type { Logger } from 'pino';
import { APP_ENV, LOGGER, type AppEnv } from '../core/tokens';
import { countryNameForCode, type AnalyticsRelayContext } from './geo-context';

export interface RelayEvent {
  readonly event: string;
  readonly distinctId: string;
  readonly timestamp: string;
  readonly properties: Record<string, unknown>;
}

export interface ClientForward {
  readonly name: string;
  readonly ts: number;
  readonly props: Readonly<Record<string, string | number | boolean | null | undefined>>;
}

/** Sanitized catalog props plus relay flags and transient GeoIP hints. Person profiles stay off unless `$identify` says otherwise. */
export function relayProperties(
  name: string,
  props: Readonly<Record<string, string | number | boolean | null | undefined>>,
  geo?: AnalyticsRelayContext,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {
    ...sanitizeAnalyticsProps(name, props),
    $process_person_profile: false,
    $lib: 'terra-relay',
  };
  if (geo?.clientIp) out.$ip = geo.clientIp;
  if (geo?.countryCode) {
    out.$geoip_country_code = geo.countryCode;
    const countryName = countryNameForCode(geo.countryCode);
    if (countryName) out.$geoip_country_name = countryName;
  }
  return out;
}

/** Redacts project (`phc_`) and personal (`phx_`) tokens so a log line cannot carry the key. */
export function redactAnalyticsText(text: string, secret?: string): string {
  let out = text.replace(/phc_\S*/g, '[redacted]').replace(/phx_\S*/g, '[redacted]');
  if (secret && secret.length > 0) out = out.split(secret).join('[redacted]');
  return out;
}

/** PostHog `/batch/` . Never throws. A blank key, `POSTHOG_ENABLED` other than `true`, or `POSTHOG_DISABLED` sends nothing. */
@Injectable()
export class PostHogClient {
  constructor(
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() @Inject(LOGGER) private readonly log?: Logger,
  ) {}

  enabled(): boolean {
    if (this.flag('ANALYTICS_DISABLED') || this.flag('POSTHOG_DISABLED') || !this.flag('POSTHOG_ENABLED')) return false;
    return this.text('POSTHOG_KEY') !== undefined;
  }

  /** Catalog client events only. Unknown names are the caller's to keep in Postgres. */
  async forwardClient(anonId: string, events: readonly ClientForward[], geo?: AnalyticsRelayContext): Promise<void> {
    const batch: RelayEvent[] = [];
    for (const event of events) {
      const spec = analyticsEvent(event.name);
      if (!spec || spec.plane === 'server') continue;
      batch.push({
        event: event.name,
        distinctId: anonId,
        timestamp: new Date(event.ts).toISOString(),
        properties: relayProperties(event.name, event.props, geo),
      });
    }
    await this.send(batch);
  }

  async send(events: readonly RelayEvent[]): Promise<void> {
    if (!this.enabled() || events.length === 0) return;
    const key = this.text('POSTHOG_KEY');
    if (!key) return;
    const body = JSON.stringify({
      api_key: key,
      batch: events.map((event) => ({
        event: event.event,
        distinct_id: event.distinctId,
        timestamp: event.timestamp,
        properties: event.properties,
      })),
    });
    try {
      await this.deliver(`${this.host()}/batch/`, body);
    } catch (error) {
      this.failed(0, error);
    }
  }

  private async deliver(url: string, body: string): Promise<void> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(2_000),
    });
    await res.body?.cancel().catch(() => undefined);
    if (!res.ok) this.failed(res.status);
  }

  private host(): string {
    return (this.text('POSTHOG_HOST') ?? 'https://eu.i.posthog.com').replace(/\/+$/, '');
  }

  private flag(name: string): boolean {
    return this.env?.[name] === true;
  }

  private text(name: string): string | undefined {
    const value = this.env?.[name];
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  /** Status only. The response body is never read: it could echo the key. */
  private failed(status: number, error?: unknown): void {
    const raw = error instanceof Error ? error.message : '';
    const err = redactAnalyticsText(raw, this.text('POSTHOG_KEY'));
    const payload = err ? { status, err } : { status };
    this.log?.warn(payload, 'analytics forward failed');
  }
}
