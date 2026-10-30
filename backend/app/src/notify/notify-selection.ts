export type NotifyAdapterKind = 'mock' | 'live';

/** `NOTIFY_ADAPTER`: the exact strings `live`, `webpush` or `telegram` select the real notifier; anything else is `mock`. */
export function notifyAdapter(env: Readonly<Record<string, string | undefined>>): NotifyAdapterKind {
  const v = env.NOTIFY_ADAPTER;
  return v === 'live' || v === 'webpush' || v === 'telegram' ? 'live' : 'mock';
}
