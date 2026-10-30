/** @terra/config: zod env loader, merged per module (D-30 rules 3 and 7). Node-only. */
export { envFlagTrue, zFlag } from './flag';
export { defineEnv, parseEnv, EnvError, type EnvSection } from './section';
export { readEnvSource } from './files';
export { coreEnv, portsFor, appPort, databaseUrl, PORT_OFFSETS, type CoreEnv } from './core';
