import { coreEnv, defineEnv, envFlagTrue, type EnvSection } from '@terra/config';
import { z } from 'zod';
import type { AdapterDef } from './adapters.js';

export interface GuardedPort {
  readonly name: string;
  /** Env variable that selects this port's adapter (named in errors). */
  readonly key: string;
  readonly kind: (source: Record<string, string | undefined>) => string;
  readonly token: abstract new () => object;
}

/**
 * Builds a module's env section with the fail-closed guard (D-30 rule 3), evaluated before Nest starts:
 * - with `NODE_ENV=production`, any port that resolves to mock aborts boot unless `allowFlag` is exactly `true`; the message names every mocked port;
 * - a port whose selected real adapter (`testnet`/`mainnet`/`zai`/`live`) is not registered aborts boot in every environment, naming the port.
 * `shape` holds the selection variables; `NODE_ENV` and the allow flag are added.
 */
export function guardedEnv(name: string, shape: z.ZodRawShape, allowFlag: string, ports: readonly GuardedPort[], adapters: readonly AdapterDef[]): EnvSection {
  const base = defineEnv(name, { NODE_ENV: coreEnv.schema.shape.NODE_ENV, ...shape, [allowFlag]: z.string().optional() });
  const schema = base.schema.superRefine((v, ctx) => {
    const source = v as Record<string, string | undefined>;
    const kinds = ports.map((p) => ({ p, kind: p.kind(source) }));
    for (const { p, kind } of kinds)
      if (kind !== 'mock' && !adapters.some((a) => a.port === p.token && a.kind === kind))
        ctx.addIssue({ code: 'custom', path: [p.key], message: `${p.name}: "${kind}" adapter selected but none is registered` });
    const mocked = kinds.filter((k) => k.kind === 'mock').map((k) => k.p.name);
    if (source.NODE_ENV === 'production' && mocked.length && !envFlagTrue(source[allowFlag]))
      ctx.addIssue({ code: 'custom', path: [allowFlag], message: `production refuses mock adapters for ${mocked.join(', ')} — select a real adapter for each (${ports.filter((p) => mocked.includes(p.name)).map((p) => p.key).join(', ')}) or set ${allowFlag}=true` });
  });
  return { name, schema } as unknown as EnvSection;
}
