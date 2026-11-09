import { Counter, type Registry } from 'prom-client';

const SENT = 'notify_sent_total';
const SUPPRESSED = 'notify_suppressed_connected_total';

let sent: Counter<'kind' | 'channel'> | undefined;
let suppressed: Counter<string> | undefined;

/** `notify_sent_total{kind,channel}` and `notify_suppressed_connected_total` on the shared registry. */
export function installNotifyMetrics(registry: Registry): void {
  if (!sent) {
    sent = new Counter({
      name: SENT,
      help: 'Notifications stored once per colony, event and channel',
      labelNames: ['kind', 'channel'],
      registers: [registry],
    });
  } else if (!registry.getSingleMetric(SENT)) registry.registerMetric(sent);
  if (!suppressed) {
    suppressed = new Counter({
      name: SUPPRESSED,
      help: 'Notifications skipped because the colony has a connected socket',
      registers: [registry],
    });
  } else if (!registry.getSingleMetric(SUPPRESSED)) registry.registerMetric(suppressed);
}

/** One count for the first insert only. A duplicate idempotent send must not call this. */
export function noteNotifySent(kind: string, channel: string): void {
  sent?.inc({ kind, channel });
}

export function noteNotifySuppressedConnected(): void {
  suppressed?.inc();
}
