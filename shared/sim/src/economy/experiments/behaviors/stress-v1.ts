import type { ResourceKey } from '@terra/contracts';
import type { BehaviorContext, BehaviorProfile } from '../types';
import { specialistsV1 } from './specialists-v1';

/**
 * Behaviour `stress-v1` (W13-47): `specialists-v1` trading plus what the stress suite adds on top, all configured by the
 * scenario (`assumptions.stress`, `assumptions.behavior`, `scenario.shocks`), nothing hard-coded as a rule:
 *  - consumption: every `projectEveryTicks` each colony enqueues the prestige project `projectId` at its Command Hub (the
 *    recurring W13-43 sink through the real queue; a colony that cannot pay is rejected and counted, never forced);
 *  - shocks at their `atTick` (relative to the run start): `exogenousInflow` credits `params.units` of `params.resource` to
 *    the listed colonies as an external, platform-fee-free inflow (a `dev.grant` command: posted as `dev.grant`, reported as `subsidy`-class, so flows
 *    still reconcile). It models inactive holders returning inventory, an external venue or a cross-planet import leak.
 */
export interface StressBehaviorParams {
  readonly projectId?: string;
  readonly projectEveryTicks?: number;
}

const projectParams = (ctx: BehaviorContext): StressBehaviorParams => (ctx.scenario.assumptions.stress as { behavior?: StressBehaviorParams } | undefined)?.behavior ?? {};

function applyShocks(ctx: BehaviorContext, start: number, done: Set<number>): void {
  const tick = ctx.host.tick - start;
  ctx.scenario.shocks.forEach((shock, i) => {
    if (done.has(i) || tick < shock.atTick) return;
    done.add(i);
    if (shock.kind !== 'exogenousInflow') return;
    const p = shock.params as { resource: ResourceKey; units: number; colonies?: number[] };
    for (const col of ctx.host.state.colonies) {
      if (!col || (p.colonies && !p.colonies.includes(col.index))) continue;
      ctx.host.submit({ colonyIndex: col.index, source: 'dev', commandId: ctx.nextCommandId(), kind: 'dev.grant', args: { resource: p.resource, amount: p.units } });
      ctx.stats.rejected['shock:exogenousInflow'] = (ctx.stats.rejected['shock:exogenousInflow'] ?? 0) + 1;
    }
  });
}

export const stressV1 = (overrides?: Readonly<Record<string, unknown>>): BehaviorProfile => {
  const inner = specialistsV1(overrides);
  const done = new Set<number>();
  let start = 0;
  let acts = 0;
  return {
    id: 'stress-v1',
    actEveryTicks: inner.actEveryTicks,
    init(ctx) { start = ctx.host.tick; },
    act(ctx) {
      applyShocks(ctx, start, done);
      const p = projectParams(ctx);
      const every = Math.max(1, Math.round((p.projectEveryTicks ?? 0) / inner.actEveryTicks));
      if (p.projectId && p.projectEveryTicks && acts % every === 0) {
        for (const col of ctx.host.state.colonies) {
          if (col && col.status !== 'eliminated') ctx.host.submit({ colonyIndex: col.index, source: 'player', commandId: ctx.nextCommandId(), kind: 'enqueueTask', args: { project: { project: p.projectId } } });
        }
      }
      acts++;
      inner.act(ctx);
    },
  };
};
