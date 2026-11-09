import { RESOURCE_KEYS } from '@terra/contracts';
import type { ParamRegistry } from './registry';
import type { ParamEntry, WaveFlags } from './types';
import { defaultParamRegistry } from './default';

export const PARAM_SCHEMA_VERSION = 1;

type JsonObject = Record<string, unknown>;

function propertySchema(e: ParamEntry, flags: WaveFlags | undefined): JsonObject {
  const base: JsonObject = {
    description: e.description,
    default: e.default,
    'x-unit': e.unit,
    'x-mutability': e.mutability,
    'x-requiredWave': e.requiredWave,
    'x-enabled': flags ? flags.has(e.requiredWave) : true,
  };
  if (e.dependencies?.length) base['x-dependencies'] = e.dependencies;
  if (e.why) base['x-why'] = e.why;
  const range = (b: NonNullable<ParamEntry['bounds']>): JsonObject => ({ minimum: Number(b.min), maximum: Number(b.max) });
  switch (e.type) {
    case 'int': return { ...base, type: 'integer', ...range(e.bounds!) };
    case 'bool': return { ...base, type: 'boolean' };
    case 'enum': return { ...base, type: 'string', enum: e.enumValues };
    case 'atomic':
      return { ...base, type: 'string', pattern: '^(0|[1-9][0-9]{0,77})$', 'x-minimum': String(e.bounds!.min), 'x-maximum': String(e.bounds!.max), 'x-encoding': 'decimal string of market atomic units' };
    case 'intList': return { ...base, type: 'array', maxItems: e.maxItems, items: { type: 'integer', ...range(e.bounds!) } };
    case 'intMap':
      return { ...base, type: 'object', propertyNames: { enum: e.mapKeys }, additionalProperties: { type: 'integer', ...range(e.bounds!) } };
  }
}

/**
 * The versioned JSON Schema of every registered parameter (ECONOMY §6): `properties[path]` carries type, bounds, default,
 * description and `x-unit` / `x-mutability` / `x-requiredWave` / `x-dependencies`. With `flags`, `x-enabled` says whether the
 * wave is on (disabled entries are still listed so an AI can see what a wave would unlock). Deterministic: sorted by path.
 */
export function describeSchema(flags?: WaveFlags, registry: ParamRegistry = defaultParamRegistry()): JsonObject {
  const properties: JsonObject = {};
  for (const e of registry.list()) properties[e.path] = propertySchema(e, flags);
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'terra://economy/params',
    title: 'TerraAgent economy parameters',
    schemaVersion: PARAM_SCHEMA_VERSION,
    type: 'object',
    additionalProperties: false,
    properties,
    'x-resourceKeys': RESOURCE_KEYS,
  };
}
