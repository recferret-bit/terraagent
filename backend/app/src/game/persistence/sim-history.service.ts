import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional, type OnApplicationShutdown } from '@nestjs/common';
import {
  AgentDecisionHistoryResponseV1Schema,
  SimInputHistoryResponseV1Schema,
  type AgentDecisionFeedItemV1,
  type AgentDecisionHistoryResponseV1,
  type SimInputFeedItemV1,
  type SimInputHistoryResponseV1,
} from '@terra/contracts';
import type { Prisma, PrismaClient } from '@terra/db';
import type { Logger } from 'pino';
import { layerLogger } from '../../core/logging/logger';
import { persistenceEnabled } from '../../core/persistence';
import { APP_ENV, LOGGER, type AppEnv } from '../../core/tokens';
import { PRISMA } from '../../db/db.module';
import { GamePlanets } from '../game-planets.service';

const MAX_MEM_PER_PLANET = 400;
const BATCH_FLUSH_MS = 250;
const BATCH_IMMEDIATE_THRESHOLD = 40;
const MAX_PENDING_QUEUE = 4000;

function mergeChronologicalHistory<T extends { id?: string; atTick: number; createdAtMs: number }>(
  dbOldestFirst: readonly T[],
  memOldestFirst: readonly T[],
  limit: number,
): T[] {
  const byKey = new Map<string, T>();
  let fallback = 0;
  for (const item of dbOldestFirst) {
    byKey.set(item.id || `db_${fallback++}`, item);
  }
  for (const item of memOldestFirst) {
    byKey.set(item.id || `mem_${fallback++}`, item);
  }
  const merged = [...byKey.values()].sort(
    (a, b) => a.createdAtMs - b.createdAtMs || a.atTick - b.atTick,
  );
  return merged.length <= limit ? merged : merged.slice(merged.length - limit);
}

function requeueFrontBounded<T>(queue: T[], failedBatch: readonly T[]): void {
  if (!failedBatch.length) return;
  const combined = [...failedBatch, ...queue];
  queue.splice(
    0,
    queue.length,
    ...(combined.length > MAX_PENDING_QUEUE
      ? combined.slice(combined.length - MAX_PENDING_QUEUE)
      : combined),
  );
}

function asJson(v: unknown): Prisma.InputJsonValue {
  return (v ?? {}) as Prisma.InputJsonValue;
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor?: string): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const sep = raw.indexOf('|');
    if (sep <= 0) return null;
    const d = new Date(raw.slice(0, sep));
    const id = raw.slice(sep + 1);
    if (Number.isNaN(d.getTime()) || !id) return null;
    return { createdAt: d, id };
  } catch {
    return null;
  }
}

export interface InputHistoryQuery {
  readonly sectorId?: string;
  readonly colonyIndex?: number;
  readonly isBot?: boolean;
  readonly source?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface DecisionHistoryQuery {
  readonly sectorId?: string;
  readonly colonyIndex?: number;
  readonly isBot?: boolean;
  readonly actorSource?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

/**
 * Durable Postgres + fast in-memory history log of ALL simulation inputs (`world.sim_input_history`)
 * and ALL actor decisions (`ai.agent_decision_history`) for both bots and players.
 */
@Injectable()
export class SimHistoryService implements OnApplicationShutdown {
  private readonly log: Logger;
  readonly enabled: boolean;
  private readonly inputsByPlanet = new Map<string, SimInputFeedItemV1[]>();
  private readonly decisionsByPlanet = new Map<string, AgentDecisionFeedItemV1[]>();
  private readonly queuedInputs: SimInputFeedItemV1[] = [];
  private readonly queuedDecisions: AgentDecisionFeedItemV1[] = [];
  private readonly feedListeners = new Set<
    (planetId: string, inputs: readonly SimInputFeedItemV1[], decisions: readonly AgentDecisionFeedItemV1[]) => void
  >();
  private flushTimer: NodeJS.Timeout | undefined;
  private flushing: Promise<void> = Promise.resolve();
  private unsubFeeds: (() => void) | undefined;
  private readonly instanceNonce = randomUUID().replace(/-/g, '').slice(0, 10);
  private seq = 0;

  constructor(
    @Inject(APP_ENV) env: AppEnv,
    @Inject(LOGGER) root: Logger,
    @Optional() @Inject(GamePlanets) planets?: GamePlanets,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
  ) {
    this.log = layerLogger(root, 'sim', env.LOG_LEVELS as string | undefined);
    this.enabled = Boolean(prisma && persistenceEnabled(env));
    if (planets) {
      this.unsubFeeds = planets.onSimFeeds((planetId, _tick, inputs, decisions) => {
        this.recordBatch(planetId, inputs, decisions, false);
      });
    }
  }

  /** Subscribes to newly recorded inputs/decisions (e.g., ingress rejections & LLM decisions outside sim thread). */
  onExtraFeeds(
    fn: (planetId: string, inputs: readonly SimInputFeedItemV1[], decisions: readonly AgentDecisionFeedItemV1[]) => void,
  ): () => void {
    this.feedListeners.add(fn);
    return () => this.feedListeners.delete(fn);
  }

  recentInputsSync(planetId: string, limit = 100): SimInputFeedItemV1[] {
    if (limit <= 0) return [];
    const list = this.inputsByPlanet.get(planetId) ?? [];
    return limit >= list.length ? [...list] : list.slice(list.length - limit);
  }

  recentDecisionsSync(planetId: string, limit = 100): AgentDecisionFeedItemV1[] {
    if (limit <= 0) return [];
    const list = this.decisionsByPlanet.get(planetId) ?? [];
    return limit >= list.length ? [...list] : list.slice(list.length - limit);
  }

  async recentInputsAsync(planetId: string, limit = 100): Promise<SimInputFeedItemV1[]> {
    if (limit <= 0) return [];
    const mem = this.recentInputsSync(planetId, limit);
    if (mem.length >= limit || !this.enabled || !this.prisma) return mem;
    try {
      const res = await this.queryInputs(planetId, { limit });
      return mergeChronologicalHistory([...res.items].reverse(), mem, limit);
    } catch (e) {
      this.log.warn({ err: e instanceof Error ? e.message : String(e), planetId }, 'sim input history backfill failed');
      return mem;
    }
  }

  async recentDecisionsAsync(planetId: string, limit = 100): Promise<AgentDecisionFeedItemV1[]> {
    if (limit <= 0) return [];
    const mem = this.recentDecisionsSync(planetId, limit);
    if (mem.length >= limit || !this.enabled || !this.prisma) return mem;
    try {
      const res = await this.queryDecisions(planetId, { limit });
      return mergeChronologicalHistory([...res.items].reverse(), mem, limit);
    } catch (e) {
      this.log.warn({ err: e instanceof Error ? e.message : String(e), planetId }, 'sim decision history backfill failed');
      return mem;
    }
  }

  recordExternalInput(input: Omit<SimInputFeedItemV1, 'id'>): SimInputFeedItemV1 {
    const item: SimInputFeedItemV1 = {
      ...input,
      id: `${input.planetId.slice(0, 32)}:extin:${input.atTick}:${this.instanceNonce}:${++this.seq}`,
    };
    this.recordBatch(item.planetId, [item], [], true);
    return item;
  }

  recordExternalDecision(decision: Omit<AgentDecisionFeedItemV1, 'id'>): AgentDecisionFeedItemV1 {
    const item: AgentDecisionFeedItemV1 = {
      ...decision,
      id: `${decision.planetId.slice(0, 32)}:extdec:${decision.atTick}:${this.instanceNonce}:${++this.seq}`,
    };
    this.recordBatch(item.planetId, [], [item], true);
    return item;
  }

  private recordBatch(
    planetId: string,
    inputs: readonly SimInputFeedItemV1[],
    decisions: readonly AgentDecisionFeedItemV1[],
    emitExternal: boolean,
  ): void {
    if (inputs.length) {
      const list = this.inputsByPlanet.get(planetId) ?? [];
      list.push(...inputs);
      if (list.length > MAX_MEM_PER_PLANET) list.splice(0, list.length - MAX_MEM_PER_PLANET);
      this.inputsByPlanet.set(planetId, list);
      if (this.enabled) this.queuedInputs.push(...inputs);
    }
    if (decisions.length) {
      const list = this.decisionsByPlanet.get(planetId) ?? [];
      list.push(...decisions);
      if (list.length > MAX_MEM_PER_PLANET) list.splice(0, list.length - MAX_MEM_PER_PLANET);
      this.decisionsByPlanet.set(planetId, list);
      if (this.enabled) this.queuedDecisions.push(...decisions);
    }
    if (emitExternal && (inputs.length || decisions.length)) {
      for (const fn of this.feedListeners) fn(planetId, inputs, decisions);
    }
    if (!this.enabled) return;
    if (this.queuedInputs.length + this.queuedDecisions.length >= BATCH_IMMEDIATE_THRESHOLD) {
      void this.flush();
    } else if (!this.flushTimer && (this.queuedInputs.length || this.queuedDecisions.length)) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = undefined;
        void this.flush();
      }, BATCH_FLUSH_MS);
      this.flushTimer.unref?.();
    }
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    const prev = this.flushing;
    const run = prev.then(async () => {
      if (!this.enabled || !this.prisma) return;
      const inBatch = this.queuedInputs.splice(0);
      const decBatch = this.queuedDecisions.splice(0);
      if (!inBatch.length && !decBatch.length) return;
      if (inBatch.length) {
        try {
          await this.prisma.simInputHistory.createMany({
            skipDuplicates: true,
            data: inBatch.map((item) => ({
              id: item.id ?? `in_${item.atTick}_${++this.seq}`,
              planetId: item.planetId,
              sectorId: item.sectorId,
              colonyId: item.colonyId ?? null,
              colonyIndex: item.colonyIndex,
              actorId: item.actorId ?? null,
              isBot: item.isBot,
              source: item.source,
              commandId: item.commandId,
              kind: item.kind,
              argsJson: asJson(item.args),
              status: item.status,
              rejectCode: item.rejectCode ?? null,
              rejectDetail: item.rejectDetail ?? null,
              issuedAtTick: item.atTick,
              appliedAtTick: item.atTick,
              createdAt: new Date(item.createdAtMs),
            })),
          });
        } catch (e) {
          requeueFrontBounded(this.queuedInputs, inBatch);
          this.log.warn({ err: e instanceof Error ? e.message : String(e) }, 'sim input history flush failed');
        }
      }
      if (decBatch.length) {
        try {
          await this.prisma.agentDecisionHistory.createMany({
            skipDuplicates: true,
            data: decBatch.map((item) => ({
              id: item.id ?? `dec_${item.atTick}_${++this.seq}`,
              planetId: item.planetId,
              sectorId: item.sectorId,
              colonyId: item.colonyId ?? null,
              colonyIndex: item.colonyIndex,
              actorId: item.actorId ?? null,
              isBot: item.isBot,
              actorSource: item.actorSource,
              decisionKind: item.decisionKind,
              summary: item.summary,
              rationale: item.rationale ?? null,
              commandId: item.commandId ?? null,
              commandKind: item.commandKind ?? null,
              payloadJson: asJson(item.payload),
              outcome: item.outcome,
              atTick: item.atTick,
              createdAt: new Date(item.createdAtMs),
            })),
          });
        } catch (e) {
          requeueFrontBounded(this.queuedDecisions, decBatch);
          this.log.warn({ err: e instanceof Error ? e.message : String(e) }, 'sim decision history flush failed');
        }
      }
    });
    this.flushing = run;
    await run;
  }

  async queryInputs(planetId: string, q: InputHistoryQuery = {}): Promise<SimInputHistoryResponseV1> {
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
    if (!this.enabled || !this.prisma) {
      const mem = (this.inputsByPlanet.get(planetId) ?? []).filter(
        (i) =>
          (q.sectorId === undefined || i.sectorId === q.sectorId) &&
          (q.colonyIndex === undefined || i.colonyIndex === q.colonyIndex) &&
          (q.isBot === undefined || i.isBot === q.isBot) &&
          (q.source === undefined || i.source === q.source),
      );
      const items = [...mem].reverse().slice(0, limit);
      return SimInputHistoryResponseV1Schema.parse({ planetId, items, nextCursor: null });
    }
    await this.flush();
    const cur = decodeCursor(q.cursor);
    const rows = await this.prisma.simInputHistory.findMany({
      where: {
        planetId,
        ...(q.sectorId ? { sectorId: q.sectorId } : {}),
        ...(q.colonyIndex !== undefined ? { colonyIndex: q.colonyIndex } : {}),
        ...(q.isBot !== undefined ? { isBot: q.isBot } : {}),
        ...(q.source ? { source: q.source } : {}),
        ...(cur
          ? {
              OR: [
                { createdAt: { lt: cur.createdAt } },
                { createdAt: cur.createdAt, id: { lt: cur.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    const items: SimInputFeedItemV1[] = sliced.map((r) => ({
      id: r.id,
      planetId: r.planetId,
      sectorId: r.sectorId,
      colonyId: r.colonyId,
      colonyIndex: r.colonyIndex,
      actorId: r.actorId,
      isBot: r.isBot,
      source: r.source as SimInputFeedItemV1['source'],
      commandId: r.commandId,
      kind: r.kind,
      args: r.argsJson,
      status: (r.status === 'rejected' || r.status === 'queued' ? r.status : 'applied'),
      rejectCode: r.rejectCode,
      rejectDetail: r.rejectDetail,
      atTick: r.appliedAtTick ?? r.issuedAtTick ?? 0,
      createdAtMs: r.createdAt.getTime(),
    }));
    const last = sliced[sliced.length - 1];
    return SimInputHistoryResponseV1Schema.parse({
      planetId,
      items,
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    });
  }

  async queryDecisions(planetId: string, q: DecisionHistoryQuery = {}): Promise<AgentDecisionHistoryResponseV1> {
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
    if (!this.enabled || !this.prisma) {
      const mem = (this.decisionsByPlanet.get(planetId) ?? []).filter(
        (d) =>
          (q.sectorId === undefined || d.sectorId === q.sectorId) &&
          (q.colonyIndex === undefined || d.colonyIndex === q.colonyIndex) &&
          (q.isBot === undefined || d.isBot === q.isBot) &&
          (q.actorSource === undefined || d.actorSource === q.actorSource),
      );
      const items = [...mem].reverse().slice(0, limit);
      return AgentDecisionHistoryResponseV1Schema.parse({ planetId, items, nextCursor: null });
    }
    await this.flush();
    const cur = decodeCursor(q.cursor);
    const rows = await this.prisma.agentDecisionHistory.findMany({
      where: {
        planetId,
        ...(q.sectorId ? { sectorId: q.sectorId } : {}),
        ...(q.colonyIndex !== undefined ? { colonyIndex: q.colonyIndex } : {}),
        ...(q.isBot !== undefined ? { isBot: q.isBot } : {}),
        ...(q.actorSource ? { actorSource: q.actorSource } : {}),
        ...(cur
          ? {
              OR: [
                { createdAt: { lt: cur.createdAt } },
                { createdAt: cur.createdAt, id: { lt: cur.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    const items: AgentDecisionFeedItemV1[] = sliced.map((r) => ({
      id: r.id,
      planetId: r.planetId,
      sectorId: r.sectorId,
      colonyId: r.colonyId,
      colonyIndex: r.colonyIndex,
      actorId: r.actorId,
      isBot: r.isBot,
      actorSource: r.actorSource,
      decisionKind: r.decisionKind,
      summary: r.summary,
      rationale: r.rationale,
      commandId: r.commandId,
      commandKind: r.commandKind,
      payload: r.payloadJson,
      outcome:
        r.outcome === 'applied' || r.outcome === 'rejected' || r.outcome === 'skipped'
          ? r.outcome
          : 'emitted',
      atTick: r.atTick,
      createdAtMs: r.createdAt.getTime(),
    }));
    const last = sliced[sliced.length - 1];
    return AgentDecisionHistoryResponseV1Schema.parse({
      planetId,
      items,
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    });
  }

  /** Clears in-memory and queued history for `planetId` and waits for any active DB batch flush to finish. */
  async clearPlanet(planetId: string): Promise<void> {
    this.inputsByPlanet.delete(planetId);
    this.decisionsByPlanet.delete(planetId);
    for (let i = this.queuedInputs.length - 1; i >= 0; i--) {
      if (this.queuedInputs[i]?.planetId === planetId) this.queuedInputs.splice(i, 1);
    }
    for (let i = this.queuedDecisions.length - 1; i >= 0; i--) {
      if (this.queuedDecisions[i]?.planetId === planetId) this.queuedDecisions.splice(i, 1);
    }
    await this.flushing;
    this.inputsByPlanet.delete(planetId);
    this.decisionsByPlanet.delete(planetId);
  }

  async onApplicationShutdown(): Promise<void> {
    this.unsubFeeds?.();
    this.unsubFeeds = undefined;
    await this.flush();
  }
}
