import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { NotifierPort } from '../ports/notifier.port.js';
import { discoverAdapters } from '../ports/adapters.js';
import { bindPorts } from '../ports/binding.js';
import { guardedEnv } from '../ports/prod-guard.js';
import { notifyAdapter } from './notify-selection.js';

export const notifyAdapters = await discoverAdapters(fileURLToPath(new URL('./adapters/', import.meta.url)));

export const env = guardedEnv('notify', { NOTIFY_ADAPTER: z.string().optional() }, 'NOTIFY_ALLOW_MOCK_IN_PROD',
  [{ name: 'Notifier', token: NotifierPort, key: 'NOTIFY_ADAPTER', kind: notifyAdapter }], notifyAdapters);

/** Binds `NotifierPort` to the adapter selected by `NOTIFY_ADAPTER` (the only importer of `notify/adapters`). */
export const NotifyModule = bindPorts('NotifyModule', [{ name: 'Notifier', token: NotifierPort, select: (e) => notifyAdapter(e as Record<string, string>) }], notifyAdapters);
