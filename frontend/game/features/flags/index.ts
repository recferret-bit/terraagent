import { LAST_WAVE, waveId } from '@terra/contracts';
import { defineFeature, type FeatureContext } from '../../core/registry/types';
import type { FlagSource } from '../../core/flags/resolve';

declare module '../../core/registry/types' {
  interface FeatureServices {
    /** Where the active flag set came from (the `flags` dev command prints it). */
    flagsSource?: FlagSource;
  }
}

const SOURCE_LABEL: Record<FlagSource, string> = { welcome: 'server', override: '?waves= override', default: 'default' };
const ALL = Array.from({ length: LAST_WAVE + 1 }, (_, i) => waveId(i));

const flagLines = (ctx: FeatureContext) =>
  `${ctx.flags.size}/${ALL.length} on (${SOURCE_LABEL[ctx.services.flagsSource ?? 'default']}): ${ALL.filter((w) => ctx.flags.has(w)).join(' ')}`;

/** Wave flags have no HUD panel. The `flags` dev command prints the enabled set and its source. */
export default defineFeature({
  id: 'flags',
  wave: 'W00',
  devCommands: [{ name: 'flags', help: 'Print the enabled waves and where they came from', run: (_a, ctx) => flagLines(ctx) }],
});
