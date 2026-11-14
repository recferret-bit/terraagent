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
 * or `import.meta.env.PROD`), and `false` in local/dev (`development`, `local`, `test`) builds unless overridden.
 *
 * Precedence:
 * 1. Explicit test override (`setProductionBuildOverride`)
 * 2. Explicit `appEnv` (`VITE_APP_ENV`: `'production'` -> `true`; `'development' | 'local' | 'test'` -> `false`)
 * 3. Vite `mode` (`'production'` -> `true`, any other defined mode -> `false`)
 * 4. `import.meta.env.PROD` boolean fallback
 */
export function isProductionBuild(
  mode: string | undefined = import.meta.env?.MODE,
  prod: boolean | undefined = import.meta.env?.PROD,
  appEnv: string | undefined = normalizeEnvTag(
    (import.meta.env as Record<string, unknown> | undefined)?.VITE_APP_ENV,
  ),
): boolean {
  if (productionOverride !== null) return productionOverride;
  const normalizedAppEnv = normalizeEnvTag(appEnv);
  if (normalizedAppEnv === 'production' || normalizedAppEnv === 'prod') return true;
  if (
    normalizedAppEnv === 'development' ||
    normalizedAppEnv === 'dev' ||
    normalizedAppEnv === 'local' ||
    normalizedAppEnv === 'test'
  ) {
    return false;
  }
  const normalizedMode = normalizeEnvTag(mode);
  if (normalizedMode !== undefined) return normalizedMode === 'production';
  return Boolean(prod);
}
