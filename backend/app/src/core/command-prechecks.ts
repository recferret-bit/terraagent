import { Injectable } from '@nestjs/common';
import type { RejectCode } from '@terra/contracts';

/** What a server-side precheck sees about a client command (after flag/args/origin checks, before the sim). */
export interface CommandPrecheckInput {
  readonly kind: string;
  readonly args: unknown;
  readonly playerId: string;
  readonly planetId: string;
  /** The player's colony on the planet (`col_0` for a dev scenario session), or null. */
  readonly colony: { readonly id: string; readonly colonyIndex: number } | null;
  readonly dev: boolean;
}

/** `null` = pass; otherwise the command is rejected with this code before it reaches the sim. */
export type CommandPrecheckResult = { readonly code: RejectCode; readonly detail?: string } | null;
export type CommandPrecheck = (input: CommandPrecheckInput) => CommandPrecheckResult | Promise<CommandPrecheckResult>;

/**
 * Server-side prechecks per command kind (W13-01). Every client command goes to the planet's sim (D-31); a module whose
 * rule needs server state the sim does not hold (verifier balances, DB order counts) registers a precheck here, so the
 * player gets a synchronous `cmd.reject` instead of a later async rejection. A precheck never mutates anything: the
 * authoritative check runs again under lock when the module acts on the sim's event (W13-09). Global (CoreModule).
 */
@Injectable()
export class CommandPrechecks {
  private readonly byKind = new Map<string, CommandPrecheck[]>();

  /** Registers `fn` for `kind`; returns the unregister function. */
  register(kind: string, fn: CommandPrecheck): () => void {
    const list = this.byKind.get(kind) ?? [];
    list.push(fn);
    this.byKind.set(kind, list);
    return () => {
      const cur = this.byKind.get(kind);
      if (cur) this.byKind.set(kind, cur.filter((f) => f !== fn));
    };
  }

  has(kind: string): boolean {
    return (this.byKind.get(kind)?.length ?? 0) > 0;
  }

  /** Runs the kind's prechecks in registration order; the first rejection wins. */
  async run(input: CommandPrecheckInput): Promise<CommandPrecheckResult> {
    for (const fn of this.byKind.get(input.kind) ?? []) {
      const out = await fn(input);
      if (out) return out;
    }
    return null;
  }
}
