import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { Counter } from 'prom-client';
import { MetricsRegistry } from '../../core/metrics.registry.js';
import { databaseEnabled } from '../../core/persistence.js';
import { scrapeGauge } from '../../core/scrape-gauge.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { parsePolicy } from '../treasury/policy.js';

/** Server-written funnel names. `council_opened` is client-only (BE-91). */
export const W22_SERVER_EVENTS = [
  'proposal_created',
  'vote_cast',
  'bounty_posted',
  'bounty_claimed',
  'bounty_paid',
  'mercenary_hired',
] as const;

export type W22ServerEvent = (typeof W22_SERVER_EVENTS)[number];

/** `result=open` when the row is stored `InProgress`; terminal labels only when that status is newly stored. */
export type ProposalResultLabel = 'open' | 'approved' | 'rejected' | 'expired';

const METALS = 'metals.t1';
const ANON_ID = '3f0c6f0e-6a53-4d34-9a3e-2f1b6a1a9c22';
const SESSION_ID = 'w22-treasury-session';
const LEAK = /account|colony|wallet|player/i;

export interface W22AnalyticsRow {
  readonly name: W22ServerEvent;
  readonly props: Record<string, string | number>;
}

interface WaveFlags {
  has(wave: string): boolean;
}

/** Maps the stored DAO status onto the counter label. Unknown statuses are ignored. */
export function proposalResultLabel(status: string): ProposalResultLabel | null {
  if (status === 'InProgress') return 'open';
  if (status === 'Approved') return 'approved';
  if (status === 'Rejected') return 'rejected';
  if (status === 'Expired') return 'expired';
  return null;
}

/**
 * W22-34 metrics and `core.analytics_event` rows. One recorder for treasury, bounties and mercenary hires.
 * W22 off records nothing. Props never carry an account, colony or wallet id.
 */
@Injectable()
export class W22TelemetryService {
  readonly recorded: W22AnalyticsRow[] = [];
  private readonly proposals?: Counter<'kind' | 'result'>;
  private readonly bounties?: Counter<'kind' | 'state'>;
  private readonly mercenary?: Counter<string>;

  constructor(
    @Optional() @Inject(MetricsRegistry) metrics?: MetricsRegistry,
    @Optional() @Inject(FlagsService) private readonly flags?: WaveFlags,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {
    if (!metrics) return;
    const registers = [metrics.registry];
    this.proposals = new Counter({
      name: 'treasury_proposals_total',
      help: 'Council proposals by kind and stored result (open, approved, rejected, expired)',
      labelNames: ['kind', 'result'],
      registers,
    });
    this.bounties = new Counter({
      name: 'bounties_total',
      help: 'Bounty transitions by target kind and stored state',
      labelNames: ['kind', 'state'],
      registers,
    });
    this.mercenary = new Counter({
      name: 'mercenary_contracts_total',
      help: 'Mercenary hires opened by MercenaryHireService',
      registers,
    });
    scrapeGauge(
      metrics.registry,
      { name: 'treasury_balance', help: 'Planet DAO metals.t1 balance in whole units', labelNames: ['planet'] },
      (set) => this.fillBalance(set),
    );
  }

  /** Stored `InProgress` proposal: event `proposal_created` and `result=open`. */
  proposalOpened(planetId: string, kind: string): Promise<void> {
    if (!this.enabled()) return Promise.resolve();
    this.proposals?.inc({ kind, result: 'open' });
    return this.event('proposal_created', { planetId, kind, result: 'open' });
  }

  /** A stored vote. `approved` / `rejected` also increment; a vote that stays open does not. */
  voteCast(planetId: string, kind: string, state: string): Promise<void> {
    if (!this.enabled()) return Promise.resolve();
    this.countTerminal(kind, state);
    return this.event('vote_cast', { planetId, kind });
  }

  /** Finalize (or any path) that newly stores `Approved`, `Rejected` or `Expired`. No analytics row. */
  proposalTerminal(kind: string, status: string): void {
    if (!this.enabled()) return;
    this.countTerminal(kind, status);
  }

  bountyPosted(kind: string): Promise<void> {
    return this.bounty('bounty_posted', kind, 'open');
  }

  bountyClaimed(kind: string): Promise<void> {
    return this.bounty('bounty_claimed', kind, 'claimed');
  }

  bountyPaid(kind: string): Promise<void> {
    return this.bounty('bounty_paid', kind, 'paid');
  }

  /** One opened hire. Cancel and pro-rata payout do not call this. */
  mercenaryHired(): Promise<void> {
    if (!this.enabled()) return Promise.resolve();
    this.mercenary?.inc();
    return this.event('mercenary_hired', {});
  }

  private bounty(name: W22ServerEvent, kind: string, state: string): Promise<void> {
    if (!this.enabled()) return Promise.resolve();
    this.bounties?.inc({ kind, state });
    return this.event(name, { kind, state });
  }

  private countTerminal(kind: string, status: string): void {
    const result = proposalResultLabel(status);
    if (result === 'approved' || result === 'rejected' || result === 'expired') {
      this.proposals?.inc({ kind, result });
    }
  }

  private async event(name: W22ServerEvent, props: Record<string, string | number>): Promise<void> {
    const clean = safeProps(props);
    this.recorded.push({ name, props: clean });
    const db = this.database();
    if (!db) return;
    await db.analyticsEvent.create({
      data: { name, ts: new Date(), anonId: ANON_ID, sessionId: SESSION_ID, props: clean },
    });
  }

  private async fillBalance(set: (labels: { planet: string }, value: number) => void): Promise<void> {
    if (!this.enabled() || !this.prisma) return;
    const rows = await this.prisma.mockChainDao.findMany({ select: { policy: true } });
    for (const row of rows) {
      const policy = parsePolicy(row.policy);
      set({ planet: policy.name }, wholeUnits(policy.balances[METALS]));
    }
  }

  private enabled(): boolean {
    return !this.flags || this.flags.has('W22');
  }

  private database(): PrismaClient | null {
    if (!this.prisma || !this.env || !databaseEnabled(this.env)) return null;
    return this.prisma;
  }
}

function wholeUnits(raw: string | undefined): number {
  return raw && /^(0|[1-9]\d*)$/.test(raw) ? Number(raw) : 0;
}

function safeProps(props: Record<string, string | number>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(props)) {
    if (!LEAK.test(key)) out[key] = value;
  }
  return out;
}
