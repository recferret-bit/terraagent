import type { PlanetState, SimCommand, SimHost } from '@terra/sim';

/** What a scenario's `build` may use besides the host: submit a command and settle it. Everything goes through the engine. */
export interface ScenarioApi {
  /** The freshly created planet (read it; change it only through commands). */
  readonly planet: PlanetState;
  /** Queues a command (planet-level, source `dev`) and steps one tick so it is applied; throws if the engine rejected it. */
  command(kind: string, args: unknown): void;
  /** Steps `ticks` more ticks. */
  settle(ticks: number): void;
}

export interface ScenarioDef {
  /** Stable id used by `?scenario=` and `npm run scenario`: the wave it seeds, e.g. `w00`. */
  readonly id: string;
  readonly title: string;
  /** Wave spec (`..00`, `..07`): the flags the scenario's planet runs with. */
  readonly waves: string;
  readonly seed: string;
  readonly planet: { readonly type: string; readonly planetType?: 'desert' | 'ocean' | 'temperate'; readonly radius?: number };
  /** Balance overrides applied for this scenario (shape owned by the tune issue). */
  readonly overrides?: Record<string, unknown>;
  /** Fills the fresh planet. Pure: only `@terra/sim` and `api`, no clock, randomness or I/O, so any host can run it. */
  build(host: SimHost, api: ScenarioApi): void;
}

export const defineScenario = (def: ScenarioDef): ScenarioDef => def;

export type { SimCommand };
