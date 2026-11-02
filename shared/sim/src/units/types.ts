import type { StepContext } from '../kernel/context';
import type { PlanetState } from '../kernel/state';
import type { MobileStats } from './mobility';
import type { UnitRecord } from './book';

/**
 * Unit commands (command pattern). Every input that makes a unit act — a player's right-click, a system that needs
 * a builder, a lethal hit — is one of these plain-data commands, issued through `issueUnitCommand` and executed by
 * the units runner. Commands live in `state.blobs.units` so they survive snapshots and the prediction clone.
 *
 * `source` decides who may replace a command: `player` commands come from client input and replace anything;
 * `auto` commands come from work providers (terraform, construction) and are re-evaluated every step.
 */
export type CommandSource = 'player' | 'auto';

export interface MoveCommand { kind: 'move'; source: CommandSource; q: number; r: number }
export interface StopCommand { kind: 'stop'; source: CommandSource }
export interface DieCommand { kind: 'die'; source: CommandSource }
export interface AttackCommand { kind: 'attack'; source: CommandSource; targetId: number }
export interface BuildCommand { kind: 'build'; source: CommandSource; orderId: string; q: number; r: number }
export interface TerraformCommand { kind: 'terraform'; source: CommandSource; orderId: string; q: number; r: number }

export type UnitCommand = MoveCommand | StopCommand | DieCommand | AttackCommand | BuildCommand | TerraformCommand;
export type UnitCommandKind = UnitCommand['kind'];

/** `running` keeps the command current; `done` and `failed` end it (a failed `auto` command is skipped for a while). */
export type UnitCommandStatus = 'running' | 'done' | 'failed';

/** Everything a command executor sees about the unit it drives, for one step. */
export interface UnitCtx {
  readonly state: PlanetState;
  readonly ctx: StepContext;
  readonly row: number;
  readonly id: number;
  readonly owner: number;
  readonly stats: MobileStats;
  readonly record: UnitRecord;
}

/** Pipeline stage a command's `work` runs in (SIMULATION §3): `construction` = slot 6, `combat` = slot 10. */
export type UnitWorkPhase = 'construction' | 'combat';

/**
 * One command kind. `immediate` kinds (stop, die) run once when issued and are never queued. The others become the
 * unit's current command and `execute` runs once per step in the units slot (and once more on the step its route
 * ends) until it returns `done` or `failed`: it decides and moves (approach), it does not change the world. Commands
 * that act on the world (build / terraform progress, damage) do it in `work`, which the runner calls in `phase`'s
 * pipeline slot, after every unit has moved. `key` identifies the command's target, so an auto provider re-proposing
 * the same work keeps the running command instead of restarting it.
 */
export interface UnitCommandDef<C extends UnitCommand = UnitCommand> {
  readonly kind: C['kind'];
  readonly immediate?: boolean;
  /** Game-rule check when the command is issued; returns a reject code. */
  validate?(u: UnitCtx, cmd: C): string | void;
  execute(u: UnitCtx, cmd: C): UnitCommandStatus;
  /** The stage `work` runs in (required with `work`). */
  readonly phase?: UnitWorkPhase;
  /** One step of effect on the world for a unit that `execute` brought into reach; `running` until it is done. */
  work?(u: UnitCtx, cmd: C): UnitCommandStatus;
  key?(cmd: C): string;
}

/**
 * Proposes the work an idle (or auto-driven) unit should do next, e.g. "terraform the nearest queued tile".
 * Providers are asked in priority order every step; the first proposal wins.
 */
export interface UnitWorkProvider {
  readonly id: string;
  propose(u: UnitCtx): UnitCommand | null;
}

export interface UnitRegistry {
  readonly commands: ReadonlyMap<UnitCommandKind, UnitCommandDef>;
  readonly providers: readonly UnitWorkProvider[];
}

export const defineUnitCommand = <C extends UnitCommand>(def: UnitCommandDef<C>): UnitCommandDef<C> => def;

/** A command definition of any kind (the registry's element type). */
export type AnyUnitCommandDef = { [K in UnitCommandKind]: UnitCommandDef<Extract<UnitCommand, { kind: K }>> }[UnitCommandKind];

export function createUnitRegistry(commands: readonly AnyUnitCommandDef[], providers: readonly UnitWorkProvider[]): UnitRegistry {
  const map = new Map<UnitCommandKind, UnitCommandDef>();
  for (const c of commands) {
    if (map.has(c.kind)) throw new Error(`duplicate unit command ${c.kind}`);
    map.set(c.kind, c as unknown as UnitCommandDef);
  }
  return { commands: map, providers };
}

/** Identity of a command for the "same work?" check (kind plus its target). */
export function commandKey(reg: UnitRegistry, cmd: UnitCommand): string {
  const def = reg.commands.get(cmd.kind);
  return def?.key ? def.key(cmd as never) : cmd.kind;
}
