import type { Logger } from 'pino';
import type { CoreEnv } from '@terra/config';

/** Injection token for the parsed environment (core section plus every module section). */
export const APP_ENV = Symbol('APP_ENV');

export type AppEnv = CoreEnv & Readonly<Record<string, unknown>>;

/** Injection token for the root pino logger; use `layerLogger(root, 'domain')` for a layer child. */
export const LOGGER = Symbol('LOGGER');
export type RootLogger = Logger;
