import type { SimCommandV1 } from '@terra/contracts';
import {
  allModules,
  applyTunedEntityHealth,
  buildPipeline,
  effectiveOverrides,
  mergeOverrides,
  nextLandingSite,
  regionForNewPlanet,
  tune,
  type BalanceOverrides,
  type Pipeline,
  type PlanetSchedule,
  type PlanetState,
  type PlanetTuning,
  type ResolvedRegion,
  type SimEvent,
  type SimModule,
  type StepMode,
  type TuneRequest,
} from '@terra/sim';
import type { ProductionBatches } from '../production-batches';
import type { LoadMsg, PassStat, PlanetStats, Post } from '../protocol';

/** What the host needs from the scheduler to report stats (the scheduler itself lives in the thread entry). */
export interface SchedulerView {
  info(planetId: string): PlanetSchedule | undefined;
  setMode(planetId: string, mode: StepMode): void;
  readonly maxLag: number;
  recentPasses(): PassStat[];
}

export interface Planet {
  state: PlanetState;
  pipeline: Pipeline;
  /** Balance overrides (D-35): `base` = file ⊕ scenario, `live` = dev tunes. */
  tuning: PlanetTuning;
  /** Scenario overrides of the load, kept so a profile swap can rebuild `tuning.base` (swap ⊕ scenario). */
  scenario: BalanceOverrides;
  /** Economy profile waiting for its effective tick (W13-39). */
  pendingProfile?: { readonly overrides: BalanceOverrides; readonly effectiveTick: number; readonly profileHash: string };
  pending: SimCommandV1[];
  subscribed: boolean;
  /** Tick of the last delta sent (or of the subscription); the next delta starts here (D-31). */
  lastDeltaTick: number;
  nextDeltaMs: number;
  /** Events of the open delta window; they travel inside the delta (subscribed planets only). */
  windowEvents: SimEvent[];
  deltaMs: number;
  deltaBytes: number;
  /** Stockpile `resourceProduced` batches (W02-28); only when the planet runs with W02 on. */
  production?: ProductionBatches;
}

/** New planets with W13 on get the server's resolved region (`params.region`) or, without one, the bootstrap-table region. */
export function regionParam(msg: LoadMsg, flags: readonly string[]): { region?: ResolvedRegion } {
  const region = msg.params?.region ?? regionForNewPlanet({ flags, planetType: msg.params?.type, planetId: msg.planetId });
  return region ? { region } : {};
}

/** Exact-size copy so the buffer can be transferred without dragging along unrelated bytes. */
export function owned(bytes: Uint8Array): Uint8Array {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
}

export function applyDueProfile(
  thread: number,
  planetId: string,
  p: Planet,
  extraModules: readonly SimModule[] | undefined,
  post: Post,
  publish: (planetId: string, p: Planet, events: SimEvent[]) => void,
): void {
  const pp = p.pendingProfile;
  if (!pp || p.state.meta.tick < pp.effectiveTick) return;
  p.pendingProfile = undefined;
  try {
    const base = mergeOverrides(pp.overrides, p.scenario);
    const pipeline = buildPipeline(
      p.tuning.flags,
      mergeOverrides(base, p.tuning.live),
      extraModules ? [...allModules(), ...extraModules] : undefined,
    );
    p.pipeline = pipeline;
    p.tuning = { flags: p.tuning.flags, base, live: p.tuning.live };
    const dataHash = pipeline.config.data.hash;
    publish(planetId, p, [
      { kind: 'dev.tuned', severity: 'info', colonyIds: [], data: { op: 'reset', dataHash }, atTick: p.state.meta.tick },
    ]);
    post({ t: 'profileApplied', planetId, tick: p.state.meta.tick, profileHash: pp.profileHash, dataHash });
  } catch (e) {
    post({ t: 'error', thread, planetId, message: `profile ${pp.profileHash}: ${e instanceof Error ? e.message : String(e)}` });
  }
}

export function replyLandingSite(
  p: Planet | undefined,
  planetId: string,
  reqId: number,
  colony: number,
  post: Post,
): void {
  if (!p) return post({ t: 'landingSite', planetId, reqId, answer: { ok: false, code: 'planet_not_loaded' } });
  const next = nextLandingSite(p.state, colony, { slotIndex: colony, data: p.pipeline.config.data });
  const answer = next.ok
    ? { ok: true as const, q: next.site.q, r: next.site.r, ...(next.site.slot ? { slotIndex: next.site.slot.index } : {}) }
    : { ok: false as const, code: next.code };
  post({ t: 'landingSite', planetId, reqId, answer });
}

export function runPlanetTune(
  thread: number,
  planetId: string,
  p: Planet | undefined,
  reqId: number,
  req: TuneRequest,
  extraModules: readonly SimModule[] | undefined,
  post: Post,
  publish: (planetId: string, p: Planet, events: SimEvent[]) => void,
): void {
  if (!p) return post({ t: 'error', thread, planetId, message: `tune: planet ${planetId} is not loaded` });
  const reply = (extra: { ok: boolean; text?: string; error?: string }) =>
    post({ t: 'tuned', planetId, reqId, dataHash: p.pipeline.config.data.hash, overrides: effectiveOverrides(p.tuning), ...extra });
  try {
    const out = tune(p.tuning, req, extraModules ? [...allModules(), ...extraModules] : undefined);
    if (out.next) {
      applyTunedEntityHealth(p.state, p.pipeline.config.data, out.next.pipeline.config.data);
      p.pipeline = out.next.pipeline;
      p.tuning.live = out.next.live;
    }
    if (out.event) publish(planetId, p, [{ ...out.event, atTick: p.state.meta.tick }]);
    reply({ ok: true, ...(out.text !== undefined ? { text: out.text } : {}) });
  } catch (e) {
    reply({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

export function collectPlanetStats(
  planets: ReadonlyMap<string, Planet>,
  sched: SchedulerView | undefined,
): PlanetStats[] {
  return [...planets].map(([planetId, p]) => {
    const s = sched?.info(planetId);
    return {
      planetId,
      tick: p.state.meta.tick,
      entities: p.state.entities.count,
      pendingCmds: p.pending.length,
      subscribed: p.subscribed,
      deltaMs: p.deltaMs,
      deltaBytes: p.deltaBytes,
      lagSteps: s?.lagSteps ?? 0,
      mode: s?.mode ?? 'active',
      nextDueMs: s?.nextDueMs ?? 0,
      stepsLastPass: s?.stepsLastPass ?? 0,
      warp: s?.warp ?? 1,
      warpRequested: s?.warpRequested ?? 1,
    };
  });
}
