/** One scripted command of a parity case: submitted when `atTick` ticks have been stepped since the scenario was loaded. */
export interface ParityCommand {
  /** 0..ticks-1: the command is queued before the step that takes the planet from `atTick` to `atTick + 1` ticks after load. */
  readonly atTick: number;
  readonly kind: string;
  readonly args: unknown;
}

export interface ParityCase {
  /** Scenario id (`w00`), as `createScenarioPlanet` knows it. */
  readonly scenario: string;
  /** Ticks to step (dt 1) after the scenario is built. */
  readonly ticks: number;
  /** Command log, in submission order (several commands may share a tick). */
  readonly log: readonly ParityCommand[];
  /** Case id (`w00-empty`); filled from the file name by the generated index. */
  readonly id?: string;
}

/** Declares an engine parity case (W00-58): the same scenario + log runs on the server host and the local host and must end equal. */
export const defineParityCase = (c: ParityCase): ParityCase => {
  for (const x of c.log) {
    if (!Number.isInteger(x.atTick) || x.atTick < 0 || x.atTick >= c.ticks) throw new Error(`parity case ${c.scenario}: atTick ${x.atTick} is outside 0..${c.ticks - 1}`);
  }
  return c;
};
