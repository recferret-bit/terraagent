/** Types for `load-catalog.mjs`. The host list stays in catalog.json. */

export const STACKS: readonly ['infra', 'frontend', 'backend', 'chain'];

export interface CatalogHost {
  readonly id: string;
  readonly host: string;
  readonly stack: string;
  readonly vhost: string;
  readonly index: string | null;
  readonly health?: string;
}

export interface Catalog {
  readonly wave: string;
  readonly domain: string;
  readonly stacks: readonly string[];
  readonly hosts: readonly CatalogHost[];
}

export interface DeployEnv {
  readonly TA_DOMAIN: string;
  readonly DEPLOY_HOST: string;
  readonly DEPLOY_USER: string;
}

export function catalogPath(): string;
export function loadCatalog(): Catalog;
export function hostsByStack(catalog: Catalog, stack: string): CatalogHost[];
/** `http://` origins for every catalog host. TLS is off in this phase (D-37). */
export function catalogOrigins(catalog?: Catalog): string[];
export function readDeployEnv(env?: Record<string, string | undefined>): DeployEnv;
export function validateDeployEnv(env?: Record<string, string | undefined>, catalog?: Catalog): DeployEnv;
export function loadEnvExample(): Record<string, string>;
