import { collectFeatures, selectFeatures } from './select';
import type { Feature, LoadOptions } from './types';

export * from './types';
export { selectFeatures, collectFeatures } from './select';

/** Every feature folder is picked up here; no shared file lists them. */
const modules = import.meta.glob<{ default?: Feature }>('../../features/*/index.ts', { eager: true });

export function loadFeatures(opts: LoadOptions): Feature[] {
  return selectFeatures(collectFeatures(modules), opts);
}
