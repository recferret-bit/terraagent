import type { ParamValue } from '@terra/contracts';

export type { ParamValue };

/** Units a registered parameter can carry (advertised in the schema; display and review only). */
export const PARAM_UNITS = [
  'bp', 'ratio_bp', 'whole_units', 'atomic', 'ticks', 'seconds', 'per_second', 'resource_flow', 'count', 'hz', 'flag', 'enum',
] as const;
export type ParamUnit = (typeof PARAM_UNITS)[number];

/** `int` safe integer, `atomic` decimal string, `enum` string, `bool`, `intMap` resource key → int, `intList` list of ints. */
export type ParamType = 'int' | 'atomic' | 'enum' | 'bool' | 'intMap' | 'intList';

/** `runtime`: live-tunable through a new profile version; `new_world_only`: only worlds created afterwards; `fixed`: never. */
export type ParamMutability = 'runtime' | 'new_world_only' | 'fixed';

/** Inclusive bounds. Numbers for int/intMap/intList (per element/value), decimal strings for atomic. */
export interface ParamBounds { readonly min: number | string; readonly max: number | string }

/** A cross-field rule: this parameter must be `lte`/`gte` another registered parameter (compared on effective values). */
export interface ParamDependency { readonly path: string; readonly relation: 'lte' | 'gte' }

export interface ParamEntry {
  /** `<table>.<rowId>.<field>` for data-table fields (`market.policy.platformFeeBp`); the rowId may contain dots. */
  readonly path: string;
  readonly description: string;
  readonly unit: ParamUnit;
  readonly type: ParamType;
  readonly bounds?: ParamBounds;
  readonly default: ParamValue;
  readonly mutability: ParamMutability;
  /** The wave that enables it; a disabled wave rejects the path with `wave_disabled`. */
  readonly requiredWave: string;
  readonly dependencies?: readonly ParamDependency[];
  /** `enum`: allowed values. `intMap`: allowed keys (resource keys) are `mapKeys`. */
  readonly enumValues?: readonly string[];
  readonly mapKeys?: readonly string[];
  /** `intList`: maximum number of elements. */
  readonly maxItems?: number;
  /** Why a `fixed` / `new_world_only` field is not live-tunable. */
  readonly why?: string;
}

/** A file's contribution to the registry. Registration is additive: files register entries, there is no central switch. */
export type ParamRegistrar = (registry: import('./registry').ParamRegistry) => void;

export interface WaveFlags { has(wave: string): boolean }
