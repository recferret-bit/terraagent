import { pruneRemovals } from '../ecs/store';
import { gateAwayCommand } from '../systems/away/gate';
import type { CommandHandlerDef, CommandOutcome, SimCommand } from './commands';
import type { EngineConfig } from './config';
import type { LedgerPosting, StepContext } from './context';
import type { SimEvent } from './events';
import { withLedgerSink } from './ledgerSink';
import type { PlanetState } from './state';
import { orderSystems, type SimSystem } from './system';

export interface StepStats {
  dt: number;
  tick: number;
  commands: number;
  rejected: number;
  entities: number;
}

export interface StepResult {
  events: SimEvent[];
  /** Ledger postings of this step, in order (host-only: persist them, never send them to clients). */
  postings: LedgerPosting[];
  outcomes: CommandOutcome[];
  stats: StepStats;
}

/**
 * A system threw inside `step` (LED-09). The state is changed up to that point (commands applied, earlier systems
 * run; `meta.tick` not advanced), so the host must not keep stepping it blindly. `outcomes` and `postings` are what
 * the step had produced: the treasury already changed `col.stock` for those postings, so the host journals them (and
 * answers the commands) before it decides what to do with the planet.
 */
export class StepError extends Error {
  constructor(
    readonly cause: unknown,
    readonly tick: number,
    readonly outcomes: readonly CommandOutcome[],
    readonly postings: readonly LedgerPosting[],
    readonly events: readonly SimEvent[],
  ) {
    super(`step to tick ${tick} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'StepError';
  }
}

/** A prepared engine: ordered systems and a handler table, built once per config. */
export interface Pipeline {
  readonly config: EngineConfig;
  readonly systems: readonly SimSystem[];
  readonly handlers: ReadonlyMap<string, CommandHandlerDef>;
}

export function createPipeline(config: EngineConfig): Pipeline {
  const handlers = new Map<string, CommandHandlerDef>();
  for (const h of config.handlers) {
    if (handlers.has(h.kind)) throw new Error(`duplicate command handler ${h.kind}`);
    handlers.set(h.kind, h);
  }
  return { config, systems: orderSystems(config.systems), handlers };
}

function makeContext(state: PlanetState, dt: number, p: Pipeline, events: SimEvent[], postings: LedgerPosting[]): StepContext {
  const tick = state.meta.tick + dt;
  return {
    dt, tick, flags: p.config.flags, data: p.config.data, events, postings,
    record: (posting) => { postings.push(posting); },
    rng: (stream) => state.rng[stream],
    newEntityId: () => state.meta.nextEntityId++,
    emit: (e) => { events.push({ severity: 'info', colonyIds: [], data: {}, ...e, atTick: tick }); },
  };
}

/** Slot 0: apply this step's commands in arrival order (SIM-C). Unknown kinds and disabled waves are rejected. */
function applyCommands(state: PlanetState, cmds: readonly SimCommand[], ctx: StepContext, p: Pipeline): CommandOutcome[] {
  const out: CommandOutcome[] = [];
  for (const cmd of cmds) {
    const h = p.handlers.get(cmd.kind);
    let res: string | { code: string; detail?: string; unlocksAt?: string } | undefined;
    const gated = h && ctx.flags.has(h.wave) ? gateAwayCommand(state, cmd, ctx) : undefined;
    if (!h) res = 'unknown_kind';
    else if (!ctx.flags.has(h.wave)) res = 'wave_disabled';
    else if (gated) res = gated;
    else res = h.handle(state, cmd, ctx) ?? undefined;
    const rej = typeof res === 'string' ? { code: res } : res;
    out.push({
      commandId: cmd.commandId,
      kind: cmd.kind,
      appliedAtTick: ctx.tick,
      ...(rej?.code ? { code: rej.code } : {}),
      ...(rej?.code && rej.detail ? { detail: rej.detail } : {}),
      ...(rej?.code && rej.unlocksAt ? { unlocksAt: rej.unlocksAt } : {}),
    });
  }
  return out;
}

/**
 * Advances the planet by `dt` ticks (SIM-T): commands first, then every enabled system in slot order, then the tick.
 * Mutates `state`; never reads a clock or `Math.random` (SIM-D-06). Same state + commands + dt → same result.
 */
export function step(state: PlanetState, cmds: readonly SimCommand[], dt: number, p: Pipeline): StepResult {
  if (!Number.isInteger(dt) || dt < 1) throw new Error(`step: dt must be a positive integer, got ${dt}`);
  const events: SimEvent[] = [];
  const postings: LedgerPosting[] = [];
  const ctx = makeContext(state, dt, p, events, postings);
  let outcomes: CommandOutcome[] = [];
  try {
    withLedgerSink(state, ctx, () => {
      outcomes = applyCommands(state, cmds, ctx, p);
      for (const s of p.systems) if (ctx.flags.has(s.wave)) s.run(state, ctx);
    });
  } catch (err) {
    throw new StepError(err, ctx.tick, outcomes, postings, events);
  }
  state.meta.tick = ctx.tick;
  pruneRemovals(state.entities, ctx.tick);
  const rejected = outcomes.filter((o) => o.code).length;
  return { events, postings, outcomes, stats: { dt, tick: ctx.tick, commands: cmds.length, rejected, entities: state.entities.count } };
}
