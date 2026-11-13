let productionOverride: boolean | null = null;

/** Overrides production-build detection for tests. Pass `null` to restore default env detection. */
export function setProductionBuildOverride(value: boolean | null): void {
  productionOverride = value;
}

/**
 * Returns `true` when running a production build (`import.meta.env.PROD` or `mode === 'production'`),
 * and `false` in local dev (`vite`) or test (`vitest`) environments unless overridden.
 */
export function isProductionBuild(
  mode: string | undefined = import.meta.env?.MODE,
  prod: boolean | undefined = import.meta.env?.PROD,
): boolean {
  if (productionOverride !== null) return productionOverride;
  if (mode !== undefined) return mode === 'production';
  return Boolean(prod);
}
