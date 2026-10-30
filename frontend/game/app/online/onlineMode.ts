export type OnlineMode = 'scenario' | 'host';

/** `?scenario=`, `?join=` or `?host=` turns the play page into the online flow (no prototype menu, descent or decorative colony). */
export function onlineMode(search: string): OnlineMode | null {
  const q = new URLSearchParams(search);
  if (q.has('scenario') || q.has('join')) return 'scenario';
  if (q.has('host')) return 'host';
  return null;
}
