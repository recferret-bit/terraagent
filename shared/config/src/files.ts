import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv as parseDotenv } from 'node:util';

/**
 * Builds the env source: the real environment wins over `infra/.env.worktree` (per-worktree ports and database, written by
 * the wave scripts), which wins over `infra/.env`. Files are optional and read from `dir/infra/` first, falling back to `dir` (the repo root).
 */
export function readEnvSource(dir: string, env: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  const fromFile = (name: string) => {
    const infraPath = join(dir, 'infra', name);
    if (existsSync(infraPath)) return parseDotenv(readFileSync(infraPath, 'utf8'));
    const rootPath = join(dir, name);
    return existsSync(rootPath) ? parseDotenv(readFileSync(rootPath, 'utf8')) : {};
  };
  return { ...fromFile('.env'), ...fromFile('.env.worktree'), ...env };
}
