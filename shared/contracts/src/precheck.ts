import type { RejectCode } from './errors';
import type { FlagSet } from './flags';
import { commandDef, hasCommandKind, parseCommandArgs } from './commands/index.generated';

/** The kind's owning wave, or undefined for an unknown kind. Injectable for tests (fixture kinds of other waves). */
export type CommandWaveLookup = (kind: string) => string | undefined;

export const contractCommandWave: CommandWaveLookup = (kind) => (hasCommandKind(kind) ? commandDef(kind).wave : undefined);

/**
 * Gate for an incoming command kind (PRODUCT_WAVES §3, "no flag, no feature"): unknown kinds are `unknown_kind`,
 * kinds of a disabled wave are `wave_disabled`; `null` means the command may go on to the per-kind schema check.
 */
export function commandGate(kind: string, flags: FlagSet, waveOf: CommandWaveLookup = contractCommandWave): RejectCode | null {
  const wave = waveOf(kind);
  if (!wave) return 'unknown_kind';
  return flags.has(wave) ? null : 'wave_disabled';
}

export type CommandPrecheck = { ok: true; args: unknown } | { ok: false; code: RejectCode; detail?: string };

/**
 * What every host does before a client `cmd` reaches the engine (PROTOCOL §4.2): flag gate, client origin, dev kinds only
 * outside production, strict args. Ownership lands with colonies (W01): a W00 session has none, so only dev kinds pass.
 * Shared by the app's ingress and the local host, so both reject identically.
 */
export function precheckClientCommand(kind: string, args: unknown, o: { gate(kind: string): RejectCode | null; production: boolean }): CommandPrecheck {
  const gate = o.gate(kind);
  if (gate) return { ok: false, code: gate };
  if (!hasCommandKind(kind)) return { ok: false, code: 'unknown_kind' };
  const def = commandDef(kind);
  if (def.origin !== 'client' || (def.dev && o.production)) return { ok: false, code: 'unknown_kind' };
  const parsed = parseCommandArgs(kind, args);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, code: 'invalid_args', ...(i ? { detail: `${i.path.join('.') || 'args'}: ${i.message}`.slice(0, 200) } : {}) };
  }
  if (!def.dev) return { ok: false, code: 'not_own_colony' };
  return { ok: true, args: parsed.data };
}
