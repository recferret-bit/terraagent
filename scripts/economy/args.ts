import { ECONOMY_EXIT_CODES } from '@terra/contracts';
import { CliError } from './api-client';

export interface Parsed {
  /** Command words before the first flag (`profile clone`). */
  readonly words: readonly string[];
  readonly flags: ReadonlyMap<string, string>;
}

const BOOLEAN_FLAGS = new Set(['json', 'non-production']);

export function parseArgs(argv: readonly string[]): Parsed {
  const words: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) { words.push(a); continue; }
    const name = a.slice(2);
    if (BOOLEAN_FLAGS.has(name)) { flags.set(name, 'true'); continue; }
    const v = argv[i + 1];
    if (v === undefined || (v.startsWith('--') && v !== '-')) throw new CliError(ECONOMY_EXIT_CODES.invalidInput, 'usage', `--${name} needs a value`);
    flags.set(name, v);
    i++;
  }
  return { words, flags };
}

export const need = (p: Parsed, name: string): string => {
  const v = p.flags.get(name);
  if (v === undefined || v === '') throw new CliError(ECONOMY_EXIT_CODES.invalidInput, 'usage', `missing --${name}`);
  return v;
};

/** `baseline:3` or `baseline@3` -> `{id, version}`; `version` may come from `--version`. */
export function parseRef(spec: string, version?: string): { id: string; version: number } {
  const m = /^([\w.-]+)(?:[:@](\d+))?$/.exec(spec);
  const v = m?.[2] ?? version;
  if (!m || v === undefined || !/^\d+$/.test(v)) throw new CliError(ECONOMY_EXIT_CODES.invalidInput, 'usage', `"${spec}" must look like <profile>:<version> (e.g. baseline:1)`);
  return { id: m[1]!, version: Number(v) };
}
