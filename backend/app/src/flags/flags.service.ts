import { Inject, Injectable } from '@nestjs/common';
import { commandDef, hasCommandKind, parseWaves, type FlagSet, type RejectCode } from '@terra/contracts';
import { APP_ENV, type AppEnv } from '../core/tokens';

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

/** The server's enabled wave set, parsed once from `TA_WAVES` (default `all`). Sent in `ready`/`welcome.flags`. */
@Injectable()
export class FlagsService {
  readonly flags: FlagSet;

  constructor(@Inject(APP_ENV) env: AppEnv) {
    this.flags = parseWaves(env.TA_WAVES as string | undefined);
  }

  has(wave: string): boolean {
    return this.flags.has(wave);
  }

  /** Wave ids for `ready.flags` / `welcome.flags`. */
  get list(): readonly string[] {
    return this.flags.list;
  }

  gate(kind: string, waveOf?: CommandWaveLookup): RejectCode | null {
    return commandGate(kind, this.flags, waveOf);
  }
}
