import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { ExperimentManifest, ParamValue } from '@terra/contracts';
import { canonical, compareExperiments, type ComparableExperiment, type ComparableMetric, type ComparisonResult } from '@terra/sim';
import { CoreException } from '../../core/errors';
import { PRISMA } from '../../db/db.module';
import { EconomyProfileService } from '../profile/profile.service';

const notFound = (id: string): CoreException => new CoreException('NOT_FOUND', { status: 404, message: `experiment ${id} not found` });

interface MetricRowSql { run_id: string; metric_key: string; scope: string; resource_key: string | null; pair: string | null; cohort: string | null; window_end_tick: bigint; value: Prisma.Decimal | null }

/**
 * Comparison and recommendation (W13-46). Comparison is `compareExperiments` (shared/sim, W13-48 owns the statistics);
 * `recommend` only ever returns a candidate patch with its evidence and never activates anything.
 */
@Injectable()
export class ExperimentReportService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, private readonly profiles: EconomyProfileService) {}

  private async load(id: string): Promise<ComparableExperiment & { manifest: ExperimentManifest }> {
    const e = await this.prisma.economyExperiment.findUnique({ where: { id }, include: { runs: { orderBy: { id: 'asc' }, include: { gates: true } } } });
    if (!e) throw notFound(id);
    const runIds = e.runs.filter((r) => r.status === 'completed').map((r) => r.id);
    const rows = runIds.length === 0 ? [] : await this.prisma.$queryRaw<MetricRowSql[]>`
      SELECT DISTINCT ON (run_id, metric_key, scope, resource_key, pair, cohort) run_id, metric_key, scope, resource_key, pair, cohort, window_end_tick, value
      FROM economy.metric WHERE run_id IN (${Prisma.join(runIds)})
      ORDER BY run_id, metric_key, scope, resource_key, pair, cohort, window_end_tick DESC`;
    const byRun = new Map<string, ComparableMetric[]>();
    for (const r of rows) {
      const list = byRun.get(r.run_id) ?? [];
      list.push({ metricKey: r.metric_key, scope: r.scope, resource: r.resource_key, pair: r.pair, cohort: r.cohort, windowEndTick: Number(r.window_end_tick), value: r.value === null ? null : r.value.toString() });
      byRun.set(r.run_id, list);
    }
    return {
      id: e.id, status: e.status, manifest: e.manifest as unknown as ExperimentManifest,
      runs: e.runs.map((r) => ({
        scenarioId: r.scenarioId, scenarioVersion: r.scenarioVersion, seed: Number(r.seed), status: r.status,
        gates: r.gates.map((g) => ({ gateId: g.gateId, gateVersion: g.gateVersion, outcome: g.outcome })), metrics: byRun.get(r.id) ?? [],
      })),
    };
  }

  async compare(baselineId: string, candidateId: string): Promise<ComparisonResult> {
    return compareExperiments(await this.load(baselineId), await this.load(candidateId));
  }

  /** The candidate profile version's parameter changes against its parent, as `set` ops (what an operator would review). */
  private async patchOf(manifest: ExperimentManifest): Promise<{ parent: { id: string; version: number } | null; ops: { op: 'set'; path: string; value: ParamValue }[] }> {
    const cand = await this.profiles.get(manifest.profile.id, manifest.profile.version);
    const parentRef = cand.version.parentId;
    const m = parentRef ? /^(.+)@(\d+)$/.exec(parentRef) : null;
    if (!m) return { parent: null, ops: [] };
    const parent = await this.profiles.get(m[1]!, Number(m[2]));
    const a = (parent.content.parameters ?? {}) as Record<string, ParamValue>;
    const b = (cand.content.parameters ?? {}) as Record<string, ParamValue>;
    const ops = Object.keys(b).sort().filter((p) => canonical(a[p]) !== canonical(b[p])).map((path) => ({ op: 'set' as const, path, value: b[path] as ParamValue }));
    return { parent: { id: m[1]!, version: Number(m[2]) }, ops };
  }

  /** Latest completed experiment of the candidate's parent profile on the same scenarios and seeds. */
  private async findBaseline(manifest: ExperimentManifest, parent: { id: string; version: number } | null, excludeId: string): Promise<string | null> {
    if (!parent) return null;
    const rows = await this.prisma.economyExperiment.findMany({ where: { status: 'completed', id: { not: excludeId } }, orderBy: { createdAt: 'desc' }, take: 200, select: { id: true, manifest: true } });
    const want = canonical({ s: manifest.scenarios, seeds: manifest.seeds });
    return rows.find((r) => {
      const m = r.manifest as unknown as ExperimentManifest;
      return m.profile.id === parent.id && m.profile.version === parent.version && canonical({ s: m.scenarios, seeds: m.seeds }) === want;
    })?.id ?? null;
  }

  async recommend(experimentId: string, baselineId?: string) {
    const exp = await this.load(experimentId);
    const { parent, ops } = await this.patchOf(exp.manifest);
    const base = baselineId ?? (await this.findBaseline(exp.manifest, parent, experimentId));
    const comparison = base ? compareExperiments(await this.load(base), exp) : null;
    const gates = exp.runs.flatMap((r) => r.gates);
    const failing = gates.filter((g) => g.outcome !== 'pass').length;
    const reasons: string[] = [];
    if (exp.status !== 'completed') reasons.push(`experiment is ${exp.status}`);
    if (failing > 0) reasons.push(`${failing} gate result(s) are not pass`);
    if (!comparison) reasons.push('no completed paired baseline experiment on the parent profile');
    else if (!comparison.ok) reasons.push(...comparison.errors.map((e) => e.message));
    else if (comparison.verdict === 'regression') reasons.push(`${comparison.regressions.length} gate(s) regress against the baseline`);
    const decision = reasons.length === 0 ? 'recommend' : exp.status === 'completed' && failing === 0 && !comparison?.regressions.length ? 'insufficient_evidence' : 'do_not_recommend';
    return {
      experimentId, decision, reasons,
      candidate: exp.manifest.profile, parent,
      patch: { schemaVersion: 1, ops, rationale: `recommended from experiment ${experimentId}` },
      evidence: { status: exp.status, gates: { total: gates.length, notPass: failing }, baselineId: base, comparison },
      activation: 'never performed here: an operator activates with the activate token (POST /v1/economy/activations)',
    };
  }
}
