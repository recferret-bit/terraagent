import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { parseExperimentManifest, type ExperimentManifest } from '@terra/contracts';
import { behaviorIds, hashJson, plannedSeeds, metricsCsv, metricsJsonl, scenarioHashOf, type ExperimentResult, type RunResult } from '@terra/sim';
import { CoreException } from '../../core/errors';
import { databaseEnabled } from '../../core/persistence';
import { APP_ENV, type AppEnv } from '../../core/tokens';
import { PRISMA } from '../../db/db.module';
import { loadExperimentScenarios } from '../../../../../tests/economy/scenarios';
import { EconomyProfileService } from '../profile/profile.service';
import { ArtifactStore, type ArtifactRef } from './experiment-artifacts';
import type { RunJob, RunMessage } from './experiment-worker';
import { ExperimentRepo, OPEN_RUN, padIndex, type ClaimedRun } from './experiment-repo';
import { startRun, type RunningJob } from './run-executor';

const DEFAULT_ARTIFACT_DIR = resolve(import.meta.dirname, '../../../../../tests/economy/artifacts');
const PUMP_MS = 500;
type Json = Record<string, unknown>;
const bad = (code: string, message: string, status = 422): CoreException => new CoreException(code, { status, message });

/**
 * Persistent bounded experiment jobs (W13-45, ECONOMY §6). `submit` stores the pinned manifest and its run rows and
 * returns an id (never a result); a bounded loop leases one run at a time and executes it in a `worker_thread`
 * (`run-executor.ts`) that holds no planet and no database handle. Only the `economy.experiment*`, `metric`,
 * `gate_result` and `scenario` tables are written: production profiles, activations and planets are never touched.
 */
@Injectable()
export class ExperimentJobService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('ExperimentJobService');
  private readonly repo: ExperimentRepo;
  private readonly artifacts: ArtifactStore;
  private readonly owner = `exp-${process.pid}-${randomUUID().slice(0, 8)}`;
  private readonly active = new Map<string, RunningJob>();
  private readonly workers: number;
  private readonly leaseMs: number;
  private timer: NodeJS.Timeout | null = null;
  private pumping = false;

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(APP_ENV) private readonly env: AppEnv, private readonly profiles: EconomyProfileService) {
    this.repo = new ExperimentRepo(prisma);
    this.artifacts = new ArtifactStore((env.TA_ECONOMY_ARTIFACT_DIR as string | undefined) ?? DEFAULT_ARTIFACT_DIR);
    this.workers = Math.max(1, Number(env.TA_ECONOMY_EXPERIMENT_WORKERS ?? 1));
    this.leaseMs = Math.max(1000, Number(env.TA_ECONOMY_EXPERIMENT_LEASE_MS ?? 30_000));
  }

  onModuleInit(): void {
    if (this.env.NODE_ENV !== 'test' && databaseEnabled(this.env)) this.start();
  }

  async onModuleDestroy(): Promise<void> { await this.stop(); }

  /** Starts the worker loop (idempotent). Off under `NODE_ENV=test` until a test calls it. */
  start(): void {
    this.timer ??= setInterval(() => void this.pump(), PUMP_MS);
  }

  /** Stops the loop, terminates local run threads and gives their runs back to the queue. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const j of this.active.values()) j.terminate();
    await Promise.allSettled([...this.active.values()].map((j) => j.result));
    this.active.clear();
    await this.repo.release(this.owner).catch(() => undefined);
  }

  // --- submit / status / cancel / resume ---------------------------------------------------------------------------

  async submit(raw: unknown, requestId: string): Promise<{ id: string; status: string; replayed: boolean }> {
    const parsed = parseExperimentManifest(raw);
    if (!parsed.ok) throw new CoreException('ECONOMY_INVALID', { status: 422, message: parsed.errors[0]?.message ?? 'invalid manifest', details: { errors: parsed.errors } });
    const manifest = parsed.value;
    const candidate = await this.checkPins(manifest);
    const known = loadExperimentScenarios();
    const plan = manifest.scenarios.flatMap((ref) => {
      const def = known.find((s) => s.manifest.id === ref.id && s.manifest.version === ref.version);
      if (!def) throw bad('unknown_scenario', `scenario ${ref.id}@${ref.version} is not available`);
      return plannedSeeds(manifest).map((seed) => ({ def, seed }));
    });
    const id = `exp_${createHash('sha256').update(requestId).digest('hex').slice(0, 24)}`;
    const manifestHash = hashJson(manifest);
    const existing = await this.prisma.economyExperiment.findUnique({ where: { requestId } });
    if (existing) {
      if (existing.manifestHash !== manifestHash) throw bad('request_conflict', `requestId ${requestId} was used with a different manifest`, 409);
      return { id: existing.id, status: existing.status, replayed: true };
    }
    for (const { def } of plan) {
      await this.prisma.economyScenario.upsert({ where: { id_version: { id: def.manifest.id, version: def.manifest.version } }, create: { id: def.manifest.id, version: def.manifest.version, manifest: def.manifest as never, hash: scenarioHashOf(def.manifest) }, update: {} });
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.economyExperiment.create({ data: { id, requestId, manifest: manifest as never, manifestHash, status: 'queued', progress: { planned: plan.length } } });
        await tx.economyExperimentRun.createMany({
          skipDuplicates: true,
          data: plan.map(({ def, seed }, i) => ({
            id: `${id}_r${padIndex(i)}`, experimentId: id, candidateId: candidate, scenarioId: def.manifest.id, scenarioVersion: def.manifest.version, seed: BigInt(seed),
            status: i < manifest.budget.maxRuns ? 'queued' : 'incomplete',
          })),
        });
      });
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e;
      return { id, status: 'queued', replayed: true };
    }
    return { id, status: 'queued', replayed: false };
  }

  /** The pinned profile version must exist and match the manifest's content hash; returns its version id. */
  private async checkPins(manifest: ExperimentManifest): Promise<string> {
    let exported;
    try { exported = await this.profiles.export(manifest.profile.id, manifest.profile.version); } catch { throw bad('unknown_profile', `profile ${manifest.profile.id}@${manifest.profile.version} not found`, 404); }
    if (exported.ref.hash !== manifest.profile.hash) throw bad('profile_hash_mismatch', `manifest pins ${manifest.profile.hash} but ${manifest.profile.id}@${manifest.profile.version} is ${exported.ref.hash}`, 409);
    if (!behaviorIds().includes(manifest.behaviorProfile)) throw bad('unknown_behavior', `unknown behaviorProfile ${manifest.behaviorProfile}`);
    return `${manifest.profile.id}@${manifest.profile.version}`;
  }

  async list() {
    const rows = await this.prisma.economyExperiment.findMany({ orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, requestId: true, status: true, createdAt: true, updatedAt: true, progress: true } });
    return rows.map((r) => ({ id: r.id, requestId: r.requestId, status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt, outcome: (r.progress as Json).outcome ?? null }));
  }

  async status(id: string) {
    const e = await this.prisma.economyExperiment.findUnique({ where: { id }, include: { runs: { orderBy: { id: 'asc' }, include: { gates: true } } } });
    if (!e) throw bad('NOT_FOUND', `experiment ${id} not found`, 404);
    const counts: Record<string, number> = {};
    for (const r of e.runs) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return {
      id: e.id, requestId: e.requestId, status: e.status, failure: e.failure, progress: e.progress, counts, manifestHash: e.manifestHash,
      runs: e.runs.map((r) => ({
        id: r.id, scenarioId: r.scenarioId, scenarioVersion: r.scenarioVersion, seed: Number(r.seed), status: r.status, hashes: { ...(r.hashes as Json), lease: undefined },
        artifacts: r.artifactRefs, gates: r.gates.map((g) => ({ gateId: g.gateId, gateVersion: g.gateVersion, outcome: g.outcome, observed: g.observed?.toString() ?? null, threshold: g.threshold })),
      })),
    };
  }

  async cancel(id: string) {
    await this.status(id);
    await this.prisma.$transaction(async (tx) => {
      const n = await tx.economyExperiment.updateMany({ where: { id, status: { in: ['queued', 'running'] } }, data: { status: 'cancelled', leaseOwner: null, leaseExpiresAt: null } });
      if (n.count > 0) await tx.economyExperimentRun.updateMany({ where: { experimentId: id, status: { in: [...OPEN_RUN] } }, data: { status: 'cancelled' } });
    });
    return this.status(id);
  }

  /** Requeues every run that did not complete; finished runs are kept (never duplicated). */
  async resume(id: string) {
    const e = await this.status(id);
    if (e.status === 'completed') throw bad('not_resumable', 'experiment already completed', 409);
    await this.prisma.$transaction(async (tx) => {
      await tx.economyExperimentRun.updateMany({ where: { experimentId: id, status: { in: ['cancelled', 'failed', 'incomplete'] } }, data: { status: 'queued', hashes: {} } });
      await tx.economyExperiment.update({ where: { id }, data: { status: 'queued', failure: null, progress: { ...(e.progress as Json), startedAt: null, outcome: null } as never } });
    });
    return this.status(id);
  }

  async artifact(id: string, name: string): Promise<{ text: string; type: string }> {
    const e = await this.status(id);
    const refs = [...((e.progress as Json).artifacts as ArtifactRef[] | undefined ?? []), ...e.runs.flatMap((r) => r.artifacts as unknown as ArtifactRef[])];
    const ref = refs.find((r) => r.name === name);
    if (!ref) throw bad('NOT_FOUND', `artifact ${name} not found`, 404);
    try { return { text: await this.artifacts.read(id, ref), type: name.endsWith('.csv') ? 'text/csv' : name.endsWith('.jsonl') ? 'application/x-ndjson' : 'application/json' }; } catch (err) { throw bad('artifact_corrupt', (err as Error).message, 500); }
  }

  // --- worker loop ----------------------------------------------------------------------------------------------------

  /** One loop pass: enforce wall budgets, then fill the free worker slots with leased runs. */
  async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      const expired = await this.repo.expireBudgets();
      for (const id of expired) {
        for (const [runId, j] of this.active) if (runId.startsWith(`${id}_`)) j.terminate();
        await this.finalize(id);
      }
      while (this.active.size < this.workers) {
        const run = await this.repo.claim(this.owner, this.leaseMs);
        if (!run) break;
        this.launch(run);
      }
    } catch (e) {
      this.log.warn(`experiment pump failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.pumping = false;
    }
  }

  /** Resolves when no run is leased or running here and none is queued (tests). */
  async idle(timeoutMs = 60_000): Promise<void> {
    const end = Date.now() + timeoutMs;
    for (;;) {
      await this.pump();
      const open = await this.prisma.economyExperimentRun.count({ where: { status: { in: [...OPEN_RUN] }, experiment: { status: { in: ['queued', 'running'] } } } });
      if (this.active.size === 0 && open === 0) return;
      if (Date.now() > end) throw new Error('experiment jobs did not become idle');
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  private launch(run: ClaimedRun): void {
    const manifest = run.manifest as ExperimentManifest;
    const beat = setInterval(() => {
      void this.repo.heartbeat(run.id, this.owner, this.leaseMs).then((ok) => { if (!ok) this.active.get(run.id)?.terminate(); }).catch(() => undefined);
    }, Math.max(250, Math.floor(this.leaseMs / 3)));
    const [profileId, version] = [manifest.profile.id, manifest.profile.version];
    const handle = this.profiles.export(profileId, version).then((exp) => startRun({ manifest, content: exp.content, scenarioId: run.scenarioId, scenarioVersion: run.scenarioVersion, seed: run.seed } satisfies RunJob));
    const job: RunningJob = { terminate: () => void handle.then((j) => j.terminate()), result: handle.then((j) => j.result) };
    this.active.set(run.id, job);
    void job.result
      .then((msg) => this.finishRun(run, msg))
      .catch((e: unknown) => this.finishRun(run, { ok: false, error: e instanceof Error ? e.message : String(e) }))
      .finally(() => { clearInterval(beat); this.active.delete(run.id); });
  }

  private async finishRun(run: ClaimedRun, msg: RunMessage | 'terminated'): Promise<void> {
    if (msg !== 'terminated') await this.persist(run, msg);
    await this.finalize(run.experimentId);
  }

  /** Writes one run's result under the lease check: a run that is no longer ours and running is discarded. */
  private async persist(run: ClaimedRun, msg: RunMessage): Promise<void> {
    const files: ArtifactRef[] = [];
    let result: RunResult | undefined;
    if (msg.ok) {
      result = msg.run;
      const idx = run.id.slice(run.id.lastIndexOf('_r') + 2);
      const one = { runs: [{ run: msg.run, gates: msg.gates }] } as unknown as ExperimentResult;
      files.push(await this.artifacts.write(run.experimentId, `run-${idx}-metrics.jsonl`, metricsJsonl(one)));
      files.push(await this.artifacts.write(run.experimentId, `run-${idx}-metrics.csv`, metricsCsv(one)));
      const { metrics: _m, ...rest } = msg.run;
      files.push(await this.artifacts.write(run.experimentId, `run-${idx}-summary.json`, `${JSON.stringify({ ...rest, gates: msg.gates, metricsSampled: msg.run.metrics.length }, null, 2)}\n`));
    }
    await this.prisma.$transaction(async (tx) => {
      const mine = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM economy.experiment_run WHERE id = ${run.id} AND status = 'running' AND hashes->'lease'->>'owner' = ${this.owner} FOR UPDATE`;
      if (mine.length === 0) return;
      if (!msg.ok || !result) {
        await tx.economyExperimentRun.update({ where: { id: run.id }, data: { status: 'failed', hashes: { failure: msg.ok ? 'no result' : msg.error.slice(0, 1000) } } });
        return;
      }
      await tx.economyMetric.deleteMany({ where: { runId: run.id } });
      const rows = result.metrics.map((m) => ({
        runId: run.id, windowStartTick: BigInt(m.window.startTick), windowEndTick: BigInt(m.window.endTick), scope: m.scope, resourceKey: m.resource ?? null, pair: m.pair ?? null,
        cohort: m.cohort ?? null, metricKey: m.metricKey, value: m.value, reason: m.reason ?? null, unit: m.unit,
      }));
      for (let i = 0; i < rows.length; i += 1000) await tx.economyMetric.createMany({ data: rows.slice(i, i + 1000) });
      await tx.economyGateResult.deleteMany({ where: { runId: run.id } });
      if (msg.gates.length > 0) await tx.economyGateResult.createMany({ data: msg.gates.map((g) => ({ runId: run.id, gateId: g.gateId, gateVersion: g.gateVersion, outcome: g.outcome, observed: g.observed, threshold: g.threshold })) });
      await tx.economyExperimentRun.update({ where: { id: run.id }, data: { status: 'completed', hashes: result.hashes as never, artifactRefs: files as never } });
    });
  }

  /** When no run is open, settles the experiment: `incomplete` if any run was cut by a budget, `failed`, else `completed`. Writes the summary files. */
  private async finalize(experimentId: string): Promise<void> {
    const e = await this.prisma.economyExperiment.findUnique({ where: { id: experimentId }, include: { runs: { include: { gates: true } } } });
    if (!e || e.status === 'cancelled' || !['queued', 'running'].includes(e.status)) return;
    if (e.runs.some((r) => r.status === 'queued' || r.status === 'running')) return;
    const has = (s: string): boolean => e.runs.some((r) => r.status === s);
    const status = has('failed') ? 'failed' : has('incomplete') || has('cancelled') ? 'incomplete' : 'completed';
    const gates = e.runs.flatMap((r) => r.gates);
    const outcome = status === 'incomplete' ? 'incomplete' : gates.some((g) => g.outcome !== 'pass') ? 'fail' : 'pass';
    const summary = {
      experimentId, status, outcome, manifestHash: e.manifestHash,
      runs: e.runs.map((r) => ({ id: r.id, scenarioId: r.scenarioId, seed: Number(r.seed), status: r.status, hashes: r.hashes, artifacts: r.artifactRefs, gates: r.gates.map((g) => ({ gateId: g.gateId, outcome: g.outcome, observed: g.observed?.toString() ?? null })) })),
    };
    const refs = [await this.artifacts.write(experimentId, 'manifest.json', `${JSON.stringify(e.manifest, null, 2)}\n`), await this.artifacts.write(experimentId, 'summary.json', `${JSON.stringify(summary, null, 2)}\n`)];
    const failed = e.runs.find((r) => r.status === 'failed');
    const claimed = await this.prisma.economyExperiment.updateMany({
      where: { id: experimentId, status: { in: ['queued', 'running'] } },
      data: { status, leaseOwner: null, leaseExpiresAt: null, failure: failed ? String((failed.hashes as Json).failure ?? 'run failed').slice(0, 2000) : null, progress: { ...(e.progress as Json), outcome, artifacts: refs } as never },
    });
    if (claimed.count === 0) this.log.debug(`experiment ${experimentId} was settled elsewhere`);
  }
}
