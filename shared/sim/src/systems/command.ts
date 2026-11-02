import { commandDef, type CommandKind, type CommandKindDef } from '@terra/contracts';
import type { SimCommand } from '../kernel/commands';

/**
 * What a handler reads from a command (GP-18, GP-19). Handlers parse `args` with the command's contract schema (the
 * same check ingress runs), so an internal caller (scenario, test, another module) cannot use an option a client
 * could not send; and a colony-scoped command acts for `cmd.colonyIndex` only, never for "colony 0" or "any colony".
 */

export type ArgsOf<K extends CommandKind> = ReturnType<CommandKindDef<K>['args']['parse']>;

/** `cmd.args` parsed with the contract of `kind`, or `null` when they do not match it (`invalid_args`). */
export function parseArgs<K extends CommandKind>(kind: K, args: unknown): ArgsOf<K> | null {
  const res = commandDef(kind).args.safeParse(args);
  return res.success ? (res.data as ArgsOf<K>) : null;
}

/** The colony a colony-scoped command acts for, or `not_own_colony` when it carries none (`colonyIndex: null`). */
export function commandColony(cmd: SimCommand): number | 'not_own_colony' {
  return typeof cmd.colonyIndex === 'number' && Number.isInteger(cmd.colonyIndex) && cmd.colonyIndex >= 0 ? cmd.colonyIndex : 'not_own_colony';
}
