import { pruneRemovals } from '../ecs/store';
import type { CommandHandlerDef, CommandOutcome, SimCommand } from './commands';
import type { EngineConfig } from './config';
import type { StepContext } from './context';
import type { SimEvent } from './events';
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
  outcomes: CommandOutcome[];
  stats: StepStats;
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

function makeContext(state: PlanetState, dt: number, p: Pipeline, events: SimEvent[]): StepContext {
  const tick = state.meta.tick + dt;
  return {
    dt, tick, flags: p.config.flags, data: p.config.data, events,
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
    let code: string | undefined;
    if (!h) code = 'unknown_kind';
    else if (!ctx.flags.has(h.wave)) code = 'wave_disabled';
    else code = h.handle(state, cmd, ctx) ?? undefined;
    out.push({ commandId: cmd.commandId, kind: cmd.kind, appliedAtTick: ctx.tick, ...(code ? { code } : {}) });
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
  const ctx = makeContext(state, dt, p, events);
  const outcomes = applyCommands(state, cmds, ctx, p);
  for (const s of p.systems) if (ctx.flags.has(s.wave)) s.run(state, ctx);
  state.meta.tick = ctx.tick;
  pruneRemovals(state.entities, ctx.tick);
  const rejected = outcomes.filter((o) => o.code).length;
  return { events, outcomes, stats: { dt, tick: ctx.tick, commands: cmds.length, rejected, entities: state.entities.count } };
}
