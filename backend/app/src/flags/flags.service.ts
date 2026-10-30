import { Inject, Injectable } from '@nestjs/common';
import { commandGate, contractCommandWave, parseWaves, type CommandWaveLookup, type FlagSet, type RejectCode } from '@terra/contracts';
import { APP_ENV, type AppEnv } from '../core/tokens';

export { commandGate, contractCommandWave, type CommandWaveLookup };

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
