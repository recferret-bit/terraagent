export interface CombatTestBuildEnvInput {
  readonly viteAppEnv?: string;
  readonly nodeEnv?: string;
  readonly mode?: string;
  readonly argv?: readonly string[];
}

function norm(v: string | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

/**
 * Returns `true` when the `/dev/combat-test/` HTML bundle MUST be excluded from production builds:
 * - `VITE_APP_ENV` explicitly set to anything other than `development`/`dev`/`local`/`test` (e.g. `production`, `staging`)
 * - `mode` is `production` / `prod` (unless `VITE_APP_ENV` explicitly opts into `development`/`dev`/`local`/`test`)
 * - `NODE_ENV=production` or CLI `vite build` invoked without `VITE_APP_ENV=development|dev|local|test`.
 */
export function isCombatTestExcludedFromBuild(env: CombatTestBuildEnvInput = {}): boolean {
  const localTags = new Set(['development', 'dev', 'local', 'test']);
  const appEnv = norm(env.viteAppEnv);
  if (appEnv.length > 0) return !localTags.has(appEnv);

  const mode = norm(env.mode);
  if (mode === 'production' || mode === 'prod') return true;
  if (localTags.has(mode)) return false;

  const nodeEnv = norm(env.nodeEnv);
  if (nodeEnv === 'production' || nodeEnv === 'prod') return true;

  if (env.argv?.some((a) => a === 'build')) return true;
  return false;
}

export function extractModeFromArgv(argv: readonly string[] = []): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? '';
    if (a.startsWith('--mode=')) return a.slice('--mode='.length);
    if ((a === '--mode' || a === '-m') && i + 1 < argv.length) return argv[i + 1];
  }
  return undefined;
}

export function stripCombatTestLinkFromHubHtml(html: string, excludeCombatTest: boolean): string {
  if (!excludeCombatTest) return html;
  return html.replace(
    /[ \t]*<a\b[^>]*\bhref=(?:["']\/dev\/combat-test\/?["']|\/dev\/combat-test\/?(?=[\s>]))[^>]*>[\s\S]*?<\/a>[ \t]*\r?\n?/gi,
    '',
  );
}
