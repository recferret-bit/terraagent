import {
  Inject,
  Injectable,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { Counter, type Gauge } from 'prom-client';
import { MetricsRegistry } from '../../core/metrics.registry.js';
import { databaseEnabled } from '../../core/persistence.js';
import { scrapeGauge } from '../../core/scrape-gauge.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { type ClaimedRow } from '../application/outbox/chain-outbox.repository.js';
import { OutboxListeners } from '../application/outbox/outbox-listeners.js';
import { StakingPositionSyncService } from '../staking/staking-position-sync.service.js';
import { DeedDebounceService } from './deed-debounce.service.js';
import { DeedProjectorService } from './deed-projector.service.js';
import { DeedRepository } from './deed.repository.js';

export const DEED_ANALYTICS_EVENTS = [
  'deed_viewed',
  'deed_shared',
  'stake_started',
  'stake_completed',
  'stake_cancelled',
  'unstake_started',
  'withdraw_completed',
] as const;

export type DeedAnalyticsEventName = (typeof DEED_ANALYTICS_EVENTS)[number];
export type NearDeedTxKind = 'deed_mint' | 'deed_update' | 'stake';

export interface DeedAnalyticsProps {
  readonly colonyId: string;
  readonly planetId: string;
  readonly [key: string]: string | number | boolean | null | undefined;
}

export interface RecordedDeedAnalyticsEvent {
  readonly name: DeedAnalyticsEventName;
  readonly ts: Date;
  readonly anonId: string;
  readonly sessionId: string;
  readonly props: Record<string, string | number | boolean | null>;
}

const DEFAULT_ANON_ID = '3f0c6f0e-6a53-4d34-9a3e-2f1b6a1a9c20';
const DEFAULT_SESSION_ID = 'w20-deed-session';

/**
 * Prometheus metrics (`near_tx_total{kind="deed_mint"|"deed_update"|"stake"}`, `deed_updates_pending`, `staking_positions`)
 * and analytics tracking (`deed_viewed`, `deed_shared`, `stake_started`, `stake_completed`, `stake_cancelled`,
 * `unstake_started`, `withdraw_completed`) for Colony Deeds and NEAR Staking (W20-26, NEAR §14, CLIENT §10.2).
 */
@Injectable()
export class DeedTelemetryService implements OnModuleInit, OnModuleDestroy {
  readonly recordedEvents: RecordedDeedAnalyticsEvent[] = [];
  private readonly txCounter?: Counter<'kind'>;
  private readonly updatesPendingGauge?: Gauge<string>;
  private readonly stakingPositionsGauge?: Gauge<string>;
  private readonly stops: Array<() => void> = [];

  constructor(
    @Optional() @Inject(MetricsRegistry) private readonly metrics?: MetricsRegistry,
    @Optional() @Inject(FlagsService) private readonly flags?: FlagsService,
    @Optional() @Inject(DeedRepository) private readonly deeds?: DeedRepository,
    @Optional() @Inject(DeedDebounceService) private readonly debounce?: DeedDebounceService,
    @Optional() @Inject(DeedProjectorService) private readonly projector?: DeedProjectorService,
    @Optional() @Inject(StakingPositionSyncService)
    private readonly positionSync?: StakingPositionSyncService,
    @Optional() @Inject(OutboxListeners) private readonly listeners?: OutboxListeners,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
  ) {
    if (this.metrics) {
      const reg = this.metrics.registry;
      const existingTx = reg.getSingleMetric('near_tx_total') as Counter<'kind'> | undefined;
      this.txCounter =
        existingTx ??
        new Counter({
          name: 'near_tx_total',
          help: 'Completed NEAR transactions by kind (deed_mint, deed_update, stake)',
          labelNames: ['kind'],
          registers: [reg],
        });

      const existingPending = reg.getSingleMetric('deed_updates_pending') as
        | Gauge<string>
        | undefined;
      this.updatesPendingGauge =
        existingPending ??
        scrapeGauge(
          reg,
          {
            name: 'deed_updates_pending',
            help: 'Colony Deeds with pending metadata updates or pending outbox confirmation',
            labelNames: [],
          },
          async (set) => {
            set({}, await this.computePendingDeedUpdates());
          },
        );

      const existingPositions = reg.getSingleMetric('staking_positions') as
        | Gauge<string>
        | undefined;
      this.stakingPositionsGauge =
        existingPositions ??
        scrapeGauge(
          reg,
          {
            name: 'staking_positions',
            help: 'Active NEAR staking positions across Settled Deeds',
            labelNames: [],
          },
          async (set) => {
            set({}, await this.computeActiveStakingPositions());
          },
        );
    }
  }

  onModuleInit(): void {
    if (this.stops.length > 0 || !this.listeners) return;
    this.stops.push(this.listeners.onDone((row) => this.onOutboxRowDone(row)));
  }

  onModuleDestroy(): void {
    for (const stop of this.stops.splice(0)) stop();
  }

  onOutboxRowDone(row: ClaimedRow): void {
    if (row.port !== 'DeedNft') return;
    if (row.method === 'mint') {
      this.recordTx('deed_mint');
    } else if (row.method === 'updateMetadata') {
      this.recordTx('deed_update');
    }
  }

  recordTx(kind: NearDeedTxKind): void {
    this.txCounter?.inc({ kind });
  }

  async computePendingDeedUpdates(): Promise<number> {
    if (this.flags && !this.flags.has('W20')) return 0;
    const debounced = this.debounce?.pendingCount() ?? 0;
    const allDeeds = (await this.deeds?.listAll()) ?? [];
    const pendingColonies = new Set<string>();
    for (const d of allDeeds) {
      if (
        d.chainState === 'PENDING' ||
        d.pendingMilestone !== null ||
        Boolean(this.projector?.getQueuedMilestone(d.colonyId))
      ) {
        pendingColonies.add(d.colonyId);
      }
    }
    return Math.max(debounced, pendingColonies.size);
  }

  async computeActiveStakingPositions(): Promise<number> {
    if (this.flags && !this.flags.has('W20')) return 0;
    const db = this.database();
    if (db && 'stakingPosition' in db && db.stakingPosition) {
      const dbCount = await db.stakingPosition.count();
      return Math.max(dbCount, this.positionSync?.positions.size ?? 0);
    }
    return this.positionSync?.positions.size ?? 0;
  }

  async trackEvent(
    name: DeedAnalyticsEventName,
    props: DeedAnalyticsProps,
    opts?: { anonId?: string; sessionId?: string },
  ): Promise<RecordedDeedAnalyticsEvent> {
    const cleanProps: Record<string, string | number | boolean | null> = {};
    for (const [k, v] of Object.entries(props)) {
      if (v !== undefined) cleanProps[k] = v;
    }
    const entry: RecordedDeedAnalyticsEvent = {
      name,
      ts: new Date(),
      anonId: opts?.anonId ?? DEFAULT_ANON_ID,
      sessionId: opts?.sessionId ?? DEFAULT_SESSION_ID,
      props: cleanProps,
    };
    this.recordedEvents.push(entry);

    const db = this.database();
    if (db && 'analyticsEvent' in db && db.analyticsEvent) {
      await db.analyticsEvent.create({
        data: {
          name: entry.name,
          ts: entry.ts,
          anonId: entry.anonId,
          sessionId: entry.sessionId,
          props: entry.props,
        },
      });
    }
    return entry;
  }

  private database(): PrismaClient | null {
    return this.env && databaseEnabled(this.env) && this.prisma ? this.prisma : null;
  }
}
