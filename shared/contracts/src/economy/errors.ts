import { z } from 'zod';

/**
 * Structured economy errors (ECONOMY §6, W13-36). Every validation path of the economy tooling (registry, profile
 * service, CLI, manifests) returns these, never free text, so an AI can act on `code` + `path` alone.
 */
export const ECONOMY_ERROR_CODES = [
  'unknown_path',
  'wrong_type',
  'out_of_bounds',
  'not_tunable',
  'wave_disabled',
  'unknown_resource',
  'missing_resource_coverage',
  'version_conflict',
  'invalid_manifest',
  'invalid_patch',
  'dependency_violation',
  'schema_mismatch',
] as const;
export const EconomyErrorCode = z.enum(ECONOMY_ERROR_CODES);
export type EconomyErrorCode = z.infer<typeof EconomyErrorCode>;

export const EconomyError = z.strictObject({
  code: EconomyErrorCode,
  /** The registered parameter path or the JSON path (`seeds.1`) the error is about. */
  path: z.string().optional(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type EconomyError = z.infer<typeof EconomyError>;

export function economyError(code: EconomyErrorCode, message: string, path?: string, details?: Record<string, unknown>): EconomyError {
  return { code, message, ...(path === undefined ? {} : { path }), ...(details === undefined ? {} : { details }) };
}

/** CLI exit codes (ECONOMY §6): 0 success, 2 invalid input, 3 failed gates, 4 execution failure. */
export const ECONOMY_EXIT_CODES = { ok: 0, invalidInput: 2, failedGates: 3, executionFailure: 4 } as const;
export type EconomyExitCode = (typeof ECONOMY_EXIT_CODES)[keyof typeof ECONOMY_EXIT_CODES];

/** Maps an outcome to the exit code: errors win (2), then failed gates (3). Execution failure (4) is the caller's `crashed` flag. */
export function economyExitCode(o: { readonly errors?: readonly EconomyError[]; readonly failedGates?: number; readonly crashed?: boolean }): EconomyExitCode {
  if (o.crashed) return ECONOMY_EXIT_CODES.executionFailure;
  if (o.errors && o.errors.length > 0) return ECONOMY_EXIT_CODES.invalidInput;
  if ((o.failedGates ?? 0) > 0) return ECONOMY_EXIT_CODES.failedGates;
  return ECONOMY_EXIT_CODES.ok;
}

/** zod issues → `EconomyError[]` of one code (default `invalid_manifest`), path joined with dots. */
export function zodIssuesToEconomyErrors(error: z.ZodError, code: EconomyErrorCode = 'invalid_manifest'): EconomyError[] {
  return error.issues.map((i) => economyError(code, i.message, i.path.map(String).join('.') || undefined));
}
