import type { CoreEnv } from '@terra/config';

/** Injection token for the parsed environment (core section plus every module section). */
export const APP_ENV = Symbol('APP_ENV');

export type AppEnv = CoreEnv & Readonly<Record<string, unknown>>;
