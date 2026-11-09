import type { PrismaClient } from '@prisma/client';
import type { NotificationPayload } from '@terra/contracts';
import { Registry } from 'prom-client';
import { describe, expect, it, vi } from 'vitest';
import { installAwayPolicyMetric } from '../../src/game/away-rejections';
import { emptyDigest } from '../../src/game/digest/body';
import { installDigestRowsGauge } from '../../src/game/digest/metric';
import { MemoryDigestStore } from '../../src/game/digest/memory-store';
import { PrismaDigestStore } from '../../src/game/digest/prisma-store';
import { AwayDigestService } from '../../src/game/digest/service';
import { installPlanetModeGauge } from '../../src/game/planet-mode-metric';
import { installRestartFastRunMetric } from '../../src/game/restart/metric';
import { installNotifyMetrics } from '../../src/notify/metrics';
import { MockNotifier } from '../../src/notify/mock-notifier';
import type { MockNotifyPut, MockNotifyRow, MockNotifyStore } from '../../src/notify/mock-notify.store';
import { MemoryPresence } from '../../src/notify/presence';

const NAMES = [
  'away_policy_rejections_total',
  'ta_game_planet_mode',
  'restart_fastrun_seconds',
  'notify_sent_total',
  'notify_suppressed_connected_total',
  'digest_rows',
] as const;

const COLONY = 'co_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const PLANET = 'pl_01ARZ3NDEKTSV4RRFFQ69G5FAV';

const note = (): NotificationPayload => ({
  colonyId: COLONY,
  eventId: 'evt_raid',
  kind: 'under_attack',
  channel: 'webpush',
  to: 'https://push.example/a',
  title: 'Under attack',
  body: 'A raid reached the Hub.',
});

const digestRow = (openedAt: Date) => ({
  colonyId: COLONY,
  planetId: PLANET,
  openedAt,
  lastEventSeq: 0n,
  body: emptyDigest(COLONY, openedAt.toISOString()),
});

class OnceStore implements MockNotifyStore {
  readonly rows: MockNotifyRow[] = [];
  async put(payload: NotificationPayload): Promise<MockNotifyPut> {
    const hit = this.rows.find((r) => r.colonyId === payload.colonyId && r.eventId === payload.eventId && r.channel === payload.channel);
    if (hit) return { row: hit, inserted: false };
    const row = { id: String(this.rows.length + 1), colonyId: payload.colonyId, eventId: payload.eventId, channel: payload.channel };
    this.rows.push(row);
    return { row, inserted: true };
  }
}

describe('W09-29 continuity metrics', () => {
  it('renders the six names and counts one send and one suppress', async () => {
    const reg = new Registry();
    installAwayPolicyMetric(reg);
    installPlanetModeGauge(reg, async () => []);
    installRestartFastRunMetric({ onFastRun() {} }, reg);
    installNotifyMetrics(reg);
    let digestRows = 4;
    installDigestRowsGauge(reg, () => digestRows);
    const presence = new MemoryPresence();
    const notifier = new MockNotifier(new OnceStore(), presence);
    await notifier.send(note());
    await notifier.send(note());
    presence.connect(COLONY);
    await notifier.send(note());
    const text = await reg.metrics();
    for (const name of NAMES) expect(text).toContain(name);
    expect(text).toContain('notify_sent_total{kind="under_attack",channel="webpush"} 1');
    expect(text).toContain('notify_suppressed_connected_total 1');
    expect(text).toContain('digest_rows 4');
    digestRows = 1;
    expect(await reg.metrics()).toContain('digest_rows 1');
  });

  it('counts digest rows without scanning on a read', async () => {
    const memory = new MemoryDigestStore();
    const svc = new AwayDigestService({ store: memory });
    const opened = new Date('2020-01-01T00:00:00.000Z');
    expect(svc.rowCount()).toBe(0);
    await memory.insert(digestRow(opened));
    expect(svc.rowCount()).toBe(1);
    expect(await memory.purgeOpenedBefore(new Date('2026-01-01T00:00:00.000Z'))).toBe(1);
    expect(svc.rowCount()).toBe(0);

    let rows = 2;
    const count = vi.fn(async () => rows);
    const prisma = {
      planetEventDigest: {
        count,
        create: async (args: { data: Record<string, unknown> }) => {
          rows += 1;
          return { id: 1n, closedAt: null, seenAt: null, ...args.data };
        },
        deleteMany: async () => {
          const removed = rows;
          rows = 0;
          return { count: removed };
        },
      },
    } as unknown as PrismaClient;
    const store = new PrismaDigestStore(prisma);
    expect(store.rowCount()).toBe(0);
    expect(count).not.toHaveBeenCalled();
    await store.warm();
    expect(store.rowCount()).toBe(2);
    await store.insert(digestRow(new Date('2026-11-09T00:00:00.000Z')));
    expect(store.rowCount()).toBe(3);
    expect(await store.purgeOpenedBefore(new Date('2099-01-01T00:00:00.000Z'))).toBe(3);
    expect(store.rowCount()).toBe(0);
    store.rowCount();
    expect(count).toHaveBeenCalledOnce();
  });
});
