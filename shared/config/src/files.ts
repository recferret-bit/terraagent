import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv as parseDotenv } from 'node:util';

/**
 * Builds the env source: the real environment wins over `.env.worktree` (per-worktree ports and database, written by
 * the wave scripts), which wins over `.env`. Files are optional and read from `dir` (the repo root).
 */
export function readEnvSource(dir: string, env: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  const fromFile = (name: string) => {
    const path = join(dir, name);
    return existsSync(path) ? parseDotenv(readFileSync(path, 'utf8')) : {};
  };
  return { ...fromFile('.env'), ...fromFile('.env.worktree'), ...env };
}
