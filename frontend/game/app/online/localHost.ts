import type { LocalHostOptions } from '../../store/local/protocol';
import { scenarioParam } from './sessionTarget';

export const DEFAULT_LOCAL_SCENARIO = 'w00';

/** `?host=local` → boot options (`?scenario=` default w00, `?waves=` spec); null for the server flows. */
export function localHostOptions(search: string): LocalHostOptions | null {
  const q = new URLSearchParams(search);
  if (q.get('host') !== 'local') return null;
  return { scenario: scenarioParam(search) ?? DEFAULT_LOCAL_SCENARIO, waves: q.get('waves') };
}
