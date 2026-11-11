/**
 * Economy parameter registry (W13-36, ECONOMY §6): every tunable input is a registered entry with unit, bounds,
 * default, mutability and required wave; `describeSchema` advertises them as JSON Schema; `validatePatch` /
 * `validateValue` return structured `EconomyError[]`. Pure: no I/O, no clock, no randomness.
 */
export * from './types';
export { ParamRegistry } from './registry';
export { createParamRegistry, defaultParamRegistry, PARAM_REGISTRARS } from './default';
export { describeSchema, PARAM_SCHEMA_VERSION } from './schema';
export { validateValue, validatePatch, applyPatchOps, type ValidatePatchOptions } from './validate';
export { registerField, rowsMatching, dataFields, type FieldSpec } from './fields';
export { registerMarketParams } from './register-market';
export { registerGuildParams } from './register-guild';
export { registerDataParams } from './register-data';
