// Geometry validator for kitbashed models. It works on the SUB-PARTS (not the merged mesh), because the glitches it hunts
// are relations between parts: floating pieces, parts cutting through each other, coplanar faces that z-fight, and animated
// parts that sweep into something. See .agents/skills/model-geometry-validator/SKILL.md for the workflow.
import { triArea } from './math';
import { ValidationContext, type CheckStage } from './context';
import { sanityStage } from './checks/sanity';
import { floatingStage } from './checks/floating';
import { overlapStage, cableStage } from './checks/overlaps';
import { animationStage } from './checks/animation';
import { processStage } from './checks/process';
import { appearanceStage } from './checks/appearanceStage';
import { DEFAULT_OPTIONS, type ModelInput, type Report, type ValidatorOptions } from './types';

export { DEFAULT_OPTIONS } from './types';
export type { ModelInput, PartDef, Report, Issue, Severity, PartStat, PairStat, ValidatorOptions, P } from './types';

/** The check pipeline, in report order (the pair relations are computed once, before the first stage that needs them). */
const STAGES: CheckStage[] = [floatingStage, overlapStage, cableStage, animationStage, processStage, appearanceStage];

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Share of the model's surface per zone. */
function zoneShares(ctx: ValidationContext): Record<string, number> {
  const zoneArea: Record<string, number> = {}; let totalArea = 0;
  for (const p of ctx.parts) { let a = 0; for (let i = 0; i < p.n; i++) a += triArea(p.tris, i * 9); zoneArea[p.def.zone] = (zoneArea[p.def.zone] ?? 0) + a; totalArea += a; }
  for (const k of Object.keys(zoneArea)) zoneArea[k] /= totalArea || 1;
  return zoneArea;
}

export function validateModel(model: ModelInput, options: Partial<ValidatorOptions> = {}): Report {
  const t0 = now();
  const ctx = new ValidationContext(model, { ...DEFAULT_OPTIONS, ...options });
  sanityStage(ctx);
  ctx.computeRelations();
  for (const stage of STAGES) stage(ctx);

  const { issues, parts, o } = ctx;
  const order = { error: 0, warn: 1, info: 2 } as const;
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  const errors = issues.filter((i) => i.severity === 'error').length, warnings = issues.filter((i) => i.severity === 'warn').length;
  return {
    id: model.id, label: model.label, source: model.source, partCount: ctx.n, triCount: ctx.triCount, box: ctx.all, minY: ctx.minY, issues, errors, warnings, pass: errors === 0,
    parts: parts.map((p) => ({ index: p.def.index, name: p.def.name, zone: p.def.zone, kind: p.def.kind, animType: p.def.animType, tris: p.n, box: p.box, closed: p.closed })),
    zoneArea: zoneShares(ctx), roles: ctx.roles, meanL: ctx.meanL, pairs: o.keepPairs ? ctx.pairs : undefined, ms: now() - t0,
  };
}
