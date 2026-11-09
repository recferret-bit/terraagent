import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { createApp, type CreateAppOptions } from '../../src/app';
import { UNIT_APP_ENV } from '../unit-app-env';

export const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));
export const errMods = fileURLToPath(new URL('./fixtures/errmods/', import.meta.url));

/** Scope request assertions to their correlation id; background planet restores share this logger. */
export const logsForRequest = (lines: readonly Record<string, unknown>[], requestId: string | null): Record<string, unknown>[] =>
  lines.filter((line) => line.requestId === requestId);

/** Boots the app with the error fixture module and captures pino lines (parsed JSON) from the log destination. */
export async function bootCapturing(source: Record<string, string> = {}, o: CreateAppOptions = {}) {
  const lines: Record<string, unknown>[] = [];
  const logDestination = { write: (s: string) => void lines.push(JSON.parse(s) as Record<string, unknown>) };
  const created = await createApp({
    source: { NODE_ENV: 'test', ...UNIT_APP_ENV, ...source },
    modulesDirs: [srcDir, errMods], logDestination, ...o,
  });
  await created.app.listen(0, '127.0.0.1');
  const url = (await created.app.getUrl()).replace('[::1]', '127.0.0.1');
  lines.length = 0; // drop Nest startup logs
  return { app: created.app as INestApplication, url, lines };
}
