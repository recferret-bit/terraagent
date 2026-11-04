/** Headless integrated experiment runner (W13-44, ECONOMY §6): real sim + market pure functions, isolated mock ports. */
export * from './errors';
export * from './gates';
export * from './hashes';
export * from './market-bridge';
export * from './market-harness';
export * from './replay';
export * from './run-experiment';
export * from './run-scenario';
export * from './types';
export { behaviorIds, createBehavior, SPECIALISTS_V1_PARAMS, specialistsParams } from './behaviors';
export * from './artifacts';
