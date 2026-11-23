let productionOverride: boolean | null = null;

/** Overrides production-build detection for tests. Pass `null` to restore default env detection. */
export function setProductionBuildOverride(value: boolean | null): void {
  productionOverride = value;
}

function normalizeEnvTag(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Returns `true` when running a production build (`VITE_APP_ENV=production`, `mode === 'production'`,
 * non-local custom modes such as `staging`, or `import.meta.env.PROD`), and `false` in local/dev
 * (`development`, `dev`, `local`, `test`) builds unless overridden.
 *
 * Precedence (fail-closed for non-local environments):
 * 1. Explicit test override (`setProductionBuildOverride`)
 * 2. Explicit `appEnv` (`VITE_APP_ENV`: `'development' | 'dev' | 'local' | 'test'` -> `false`; any other non-empty value e.g. `'production' | 'prod' | 'staging'` -> `true`)
 * 3. Vite `mode` (`'development' | 'dev' | 'local' | 'test'` -> `false`; `'production' | 'prod'` -> `true`; custom modes fall through to `Boolean(prod)`)
 * 4. `import.meta.env.PROD` boolean fallback
 */
interface ViteEnvBag {
  readonly MODE?: string;
  readonly PROD?: boolean;
  readonly DEV?: boolean;
  readonly VITE_APP_ENV?: unknown;
}

function readImportMetaEnv(): ViteEnvBag | undefined {
  return (import.meta as unknown as { readonly env?: ViteEnvBag }).env;
}

export function isProductionBuild(
  mode: string | undefined = readImportMetaEnv()?.MODE,
  prod: boolean | undefined = readImportMetaEnv()?.PROD,
  appEnv: string | undefined = normalizeEnvTag(readImportMetaEnv()?.VITE_APP_ENV),
): boolean {
  if (productionOverride !== null) return productionOverride;
  const normalizedAppEnv = normalizeEnvTag(appEnv);
  if (normalizedAppEnv !== undefined) {
    return !(
      normalizedAppEnv === 'development' ||
      normalizedAppEnv === 'dev' ||
      normalizedAppEnv === 'local' ||
      normalizedAppEnv === 'test'
    );
  }
  const normalizedMode = normalizeEnvTag(mode);
  if (
    normalizedMode === 'development' ||
    normalizedMode === 'dev' ||
    normalizedMode === 'local' ||
    normalizedMode === 'test'
  ) {
    return false;
  }
  if (normalizedMode === 'production' || normalizedMode === 'prod') {
    return true;
  }
  return Boolean(prod);
}
