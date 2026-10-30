import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { discoverAdapters } from '../../ports/adapters.js';
import { bindPorts } from '../../ports/binding.js';
import { guardedEnv } from '../../ports/prod-guard.js';
import { PORTS } from '../application/ports/index.js';
import type { NearPortName } from '../domain/types.js';
import { nearAdapterFor, NEAR_PORT_KEYS } from './adapter-selection.js';

/** Adapters are discovered from `./adapters/**\/*.adapter.ts` at load; see `near/README.md`. */
export const nearAdapters = await discoverAdapters(fileURLToPath(new URL('./adapters/', import.meta.url)));

const nearPorts = PORTS.filter((p) => NEAR_PORT_KEYS.some((k) => k.port === p.name));
const keyOf = (name: string) => NEAR_PORT_KEYS.find((k) => k.port === name)!.key;

/** Env section (guard runs before Nest starts); exported so tests can parse it against a fixture adapter list. */
export const nearEnvFor = (adapters: Parameters<typeof guardedEnv>[4]) =>
  guardedEnv('near', Object.fromEntries(NEAR_PORT_KEYS.map((k) => [k.key, z.string().optional()])), 'NEAR_ALLOW_MOCK_IN_PROD',
    nearPorts.map((p) => ({ name: p.name, token: p.token, key: keyOf(p.name), kind: (s) => nearAdapterFor(p.name as NearPortName, s) })), adapters);

/** The only place NEAR ports are bound: one `{ provide: XPort, useClass: <selected adapter> }` per registered port. */
export const nearInfrastructureModuleFor = (adapters: Parameters<typeof bindPorts>[2]) =>
  bindPorts('NearInfrastructureModule', nearPorts.map((p) => ({ name: p.name, token: p.token, select: (env) => nearAdapterFor(p.name as NearPortName, env as Record<string, string>) })), adapters);

export const NearInfrastructureModule = nearInfrastructureModuleFor(nearAdapters);
export const nearEnv = nearEnvFor(nearAdapters);
