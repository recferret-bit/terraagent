import { newId, parseCommandArgs, type ServerMessage } from '@terra/contracts';
import {
  effectiveOverrides,
  previewPlanetTimePatch,
  tune,
  type BalanceOverrides,
  type PlanetJournal,
  type PlanetScheduler,
  type PlanetTimePatch,
  type PlanetTuning,
  type SimCommand,
  type SimEvent,
  type SimHost,
  type TuneRequest,
} from '@terra/sim';
import { colonyPresenceAway, LocalHardModeClock, planLocalPresence } from '../devPresence';
import type { LocalCargoRelay } from '../localCargoRelay';
import { scenarioSource, type PlanetSource } from '../planetSource';

/** A dev command failed; `code` is what the console shows (`host_unavailable`, `invalid_args`, `not_found`). */
export class LocalDevError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'LocalDevError';
  }
}

export interface LocalDevContext {
  readonly down: boolean;
  readonly waves: readonly string[];
  readonly source: PlanetSource;
  readonly host: SimHost;
  readonly planetId: string;
  readonly warp: number;
  readonly joined: boolean;
  readonly tuning: PlanetTuning;
  readonly queue: SimCommand[];
  readonly window: SimEvent[];
  readonly ledger: PlanetJournal;
  readonly cargoRelay: LocalCargoRelay;
  readonly hardMode: LocalHardModeClock;
  readonly sched: PlanetScheduler;
  readonly wallMs: () => number;
  readonly restart: (source: PlanetSource) => Promise<{ planetId: string }>;
  readonly swapPipeline: (next: SimHost['pipeline'], live: BalanceOverrides) => void;
  readonly stepOnce: (dt: number) => void;
  readonly flushDelta: () => void;
  readonly server: (msg: ServerMessage) => void;
}

export async function runLocalDevCommand(
  ctx: LocalDevContext,
  name: string,
  args: unknown,
): Promise<unknown> {
  const a = (args ?? {}) as Record<string, unknown>;
  switch (name) {
    case 'warp':
      return runLocalDevWarp(ctx, a);
    case 'scenario': {
      if (typeof a.id !== 'string' || !a.id) throw new LocalDevError('invalid_args', 'scenario needs { id }');
      return ctx
        .restart(scenarioSource(a.id.toLowerCase(), ctx.waves))
        .catch((e: unknown) => {
          throw new LocalDevError('not_found', e instanceof Error ? e.message : String(e));
        });
    }
    case 'local.reset':
      return ctx.restart(ctx.source);
    case 'tune':
      return runLocalDevTune(ctx, a);
    case 'time':
      return runLocalDevTime(ctx, a);
    case 'ledger':
      return ctx.ledger.view(ctx.planetId, String(a.account ?? 'colony:0'), Number(a.limit ?? 10) || 10);
    case 'near.mock.fail':
      return ctx.cargoRelay.devFail(a);
    case 'cargo.grant':
      return ctx.cargoRelay.devGrant(a, ctx.queue);
    case 'away':
    case 'back':
    case 'colony.eliminate':
      return applyLocalDevPresence(ctx, name, a);
    default:
      throw new LocalDevError('host_unavailable', `"${name}" needs the game server; not available on this host`);
  }
}

/** `away` / `back` apply on the next step (one tick). `colony.eliminate` rejects `not_away` and does not start the clock. */
export function applyLocalDevPresence(
  ctx: LocalDevContext,
  name: string,
  args: Record<string, unknown>,
): unknown {
  if (ctx.down) throw new LocalDevError('host_unavailable', 'the local planet is down');
  const plan = planLocalPresence({
    name,
    args,
    waves: ctx.waves,
    state: ctx.host.state,
    tick: ctx.host.tick,
    nowMs: Math.round(ctx.wallMs()),
    queued: ctx.queue,
    clock: ctx.hardMode,
  });
  if (!plan.ok) throw new LocalDevError(plan.code, plan.message);
  if (plan.command) ctx.queue.push(plan.command);
  if (plan.step) {
    ctx.stepOnce(1);
    ctx.flushDelta();
    if (colonyPresenceAway(ctx.host.state, plan.colonyIndex) !== plan.expectAway) {
      throw new LocalDevError('rejected', 'system.presence was not applied');
    }
  }
  if (plan.event) ctx.server({ v: 1, t: 'event', tick: plan.event.atTick, d: plan.event });
  if (!plan.step) return plan.reply;
  return { ...plan.reply, tick: ctx.host.tick, appliedAtTick: ctx.host.tick };
}

export function runLocalDevTime(
  ctx: LocalDevContext,
  a: Record<string, unknown>,
): Record<string, unknown> {
  const { planetId: _ignored, ...rest } = a;
  const parsed = parseCommandArgs('dev.time', rest);
  if (!parsed.success) throw new LocalDevError('invalid_args', parsed.error.issues[0]?.message ?? 'invalid time args');
  const patch = parsed.data as PlanetTimePatch;
  if (patch.timeOfDay !== undefined || patch.realHoursPerDay !== undefined || patch.timeScale !== undefined) {
    ctx.queue.push({ colonyIndex: null, source: 'dev', commandId: newId('cm'), kind: 'dev.time', args: patch });
  }
  const mergedPatch: PlanetTimePatch = {};
  for (const c of ctx.queue) {
    if (c.kind === 'dev.time' || c.kind === 'setPlanetTime') {
      Object.assign(mergedPatch, c.args as PlanetTimePatch);
    }
  }
  const pt = previewPlanetTimePatch(ctx.host.state, mergedPatch, ctx.host.tick, ctx.host.pipeline.config.data);
  return {
    planetId: ctx.planetId,
    tick: ctx.host.tick,
    hour: pt.hour,
    timeOfDay: pt.timeOfDay,
    phase: pt.phase,
    cyclePhase: pt.cyclePhase,
    day: pt.day,
    daylight: pt.daylight,
    isNight: pt.isNight,
    realHoursPerDay: pt.realHoursPerDay,
    timeScale: pt.timeScale,
  };
}

export function runLocalDevWarp(
  ctx: LocalDevContext,
  a: Record<string, unknown>,
): { planetId: string; k: number } {
  const k = a.k;
  if (typeof k !== 'number' || !Number.isInteger(k) || k < 1 || k > 100) {
    throw new LocalDevError('invalid_args', 'warp needs an integer k in 1..100');
  }
  ctx.sched.setWarp('local', k);
  return { planetId: ctx.planetId, k: ctx.sched.info('local')?.warp ?? k };
}

export function runLocalDevTune(
  ctx: LocalDevContext,
  a: Record<string, unknown>,
): { dataHash: string; overrides: BalanceOverrides; text?: string } {
  const req = (
    a.op === 'set' ? { op: 'set', path: String(a.path ?? ''), value: a.value } : { op: a.op }
  ) as TuneRequest;
  if (!['set', 'reset', 'export'].includes(req.op)) {
    throw new LocalDevError('invalid_args', 'tune op must be set, reset or export');
  }
  try {
    const out = tune(ctx.tuning, req);
    const activeTuning = out.next ? { ...ctx.tuning, live: out.next.live } : ctx.tuning;
    if (out.next) ctx.swapPipeline(out.next.pipeline, out.next.live);
    if (out.event && ctx.joined) ctx.window.push({ ...out.event, atTick: ctx.host.tick });
    return {
      dataHash: (out.next?.pipeline ?? ctx.host.pipeline).config.data.hash,
      overrides: effectiveOverrides(activeTuning),
      ...(out.text !== undefined ? { text: out.text } : {}),
    };
  } catch (e) {
    throw new LocalDevError('invalid_args', e instanceof Error ? e.message : String(e));
  }
}
