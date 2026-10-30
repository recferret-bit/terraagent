import { z } from 'zod';
import { defineEnv } from './section';

const port = () => z.coerce.number().int().min(1).max(65535);

/**
 * Ports and the database follow one convention so several worktrees can run their stacks side by side
 * (PRODUCT_WAVES §7): `TA_PORT_BASE` (default 4000) → app `base + 1`, Vite client `base + 1173`, e2e app `base + 2`,
 * e2e client `base + 1174`; Postgres is shared on `TA_PG_PORT` (15434) with one database per worktree (`TA_DB_NAME`).
 */
export const PORT_OFFSETS = { app: 1, client: 1173, e2eApp: 2, e2eClient: 1174 } as const;

export const coreEnv = defineEnv('core', {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TA_PORT_BASE: port().default(4000),
  PORT: port().optional(),
  TA_PG_PORT: port().default(15434),
  TA_DB_NAME: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, 'lowercase letters, digits and _').default('terraagent'),
  DATABASE_URL: z.string().url().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGINS: z.string().optional(),
});

export type CoreEnv = z.infer<typeof coreEnv.schema>;

export function portsFor(base: number) {
  return {
    app: base + PORT_OFFSETS.app,
    client: base + PORT_OFFSETS.client,
    e2eApp: base + PORT_OFFSETS.e2eApp,
    e2eClient: base + PORT_OFFSETS.e2eClient,
  };
}

/** Effective app port: explicit `PORT`, else `TA_PORT_BASE + 1`. */
export const appPort = (env: CoreEnv) => env.PORT ?? portsFor(env.TA_PORT_BASE).app;

/** Effective database URL: explicit `DATABASE_URL`, else the shared dev Postgres with this worktree's database. */
export const databaseUrl = (env: CoreEnv) =>
  env.DATABASE_URL ?? `postgresql://terra:terra@127.0.0.1:${env.TA_PG_PORT}/${env.TA_DB_NAME}`;
