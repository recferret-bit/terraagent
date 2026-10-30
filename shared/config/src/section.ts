import { z } from 'zod';

/** One module's slice of the environment. Modules declare their own section; the app merges all sections at boot. */
export interface EnvSection<S extends z.ZodRawShape = z.ZodRawShape> {
  readonly name: string;
  readonly schema: z.ZodObject<S>;
}

export function defineEnv<S extends z.ZodRawShape>(name: string, shape: S): EnvSection<S> {
  return { name, schema: z.object(shape) };
}

/** Thrown when the environment does not parse; the message names every offending variable. */
export class EnvError extends Error {
  constructor(readonly issues: { key: string; section: string; message: string }[]) {
    super(`invalid environment:\n${issues.map((i) => `  ${i.key} (${i.section}): ${i.message}`).join('\n')}`);
    this.name = 'EnvError';
  }
}

type Out<T> = T extends EnvSection<infer S> ? z.infer<z.ZodObject<S>> : never;
type Merge<T extends readonly EnvSection[]> = T extends readonly [infer H, ...infer R extends readonly EnvSection[]]
  ? Out<H> & Merge<R>
  : unknown;

/** Parses every section against `source`; throws one `EnvError` listing all problems (boot must abort on it). */
export function parseEnv<const T extends readonly EnvSection[]>(
  sections: T,
  source: Record<string, string | undefined>,
): Merge<T> {
  const issues: EnvError['issues'] = [];
  const out: Record<string, unknown> = {};
  for (const section of sections) {
    const r = section.schema.safeParse(source);
    if (r.success) Object.assign(out, r.data);
    else for (const i of r.error.issues) issues.push({ key: String(i.path[0] ?? '?'), section: section.name, message: i.message });
  }
  if (issues.length) throw new EnvError(issues);
  return out as Merge<T>;
}
