import type { Disposable, Feature, FeatureContext } from '../../core/registry/types';
import { DevConsole } from './DevConsole';

export { DevConsole } from './DevConsole';
export { CommandRunner, type RunResult } from './runner';
export { parseLine, numArg } from './parse';

/** Dev builds always; `?dev=1` also in non-dev builds of another mode (staging). A `production`-mode build never mounts it. */
export const devConsoleEnabled = (
  search: string = location.search,
  dev: boolean = import.meta.env.DEV,
  mode: string = import.meta.env.MODE,
): boolean => dev || (mode !== 'production' && new URLSearchParams(search).get('dev') === '1');

export interface MountDevConsoleOptions {
  parent: HTMLElement;
  /** Already filtered by flags/host (`loadFeatures`): only these features' commands exist. */
  features: readonly Feature[];
  ctx: FeatureContext;
}

/** Mounts the console (backtick toggles it) and returns its disposer, or a no-op when not enabled. Call on session start, dispose on teardown. */
export function mountDevConsole({ parent, features, ctx }: MountDevConsoleOptions): Disposable & { console: DevConsole | null } {
  // Literal env checks so a production-mode build folds this away and drops DevConsole from the bundle.
  if ((!import.meta.env.DEV && import.meta.env.MODE === 'production') || !devConsoleEnabled()) return { console: null, dispose() {} };
  const c = new DevConsole(parent, features, ctx);
  return { console: c, dispose: () => c.dispose() };
}
