export const RUNNER_SCRIPT = 'scripts/economy/run-experiment.ts';

export interface ReplayTarget {
  readonly manifestPath: string;
  readonly profilePath?: string;
  readonly scenarioId: string;
  readonly seed: number;
  readonly outDir: string;
}

const quote = (s: string): string => (/^[\w./:@=+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

/** The one command line that reruns exactly one failing (scenario, seed) of a pinned manifest. */
export function replayCommand(t: ReplayTarget): string {
  const parts = ['npx', 'tsx', RUNNER_SCRIPT, '--manifest', t.manifestPath];
  if (t.profilePath) parts.push('--profile', t.profilePath);
  parts.push('--scenario', t.scenarioId, '--seed', String(t.seed), '--out', `${t.outDir}-replay-${t.scenarioId}-${t.seed}`);
  return parts.map(quote).join(' ');
}
