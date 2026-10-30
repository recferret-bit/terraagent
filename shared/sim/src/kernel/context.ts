import type { SimEvent, EmitInput } from './events';
import type { RngStream } from './rng';
import type { CompiledDataLike } from './config';

/** Everything a system sees besides the state, for one step. */
export interface StepContext {
  /** Ticks this step advances (1 active, 5 coarse). */
  readonly dt: number;
  /** The tick this step produces (`state.meta.tick + dt`); stamp `changedAt` with it. */
  readonly tick: number;
  /** Enabled wave flags. */
  readonly flags: ReadonlySet<string>;
  /** Compiled data tables (design units already converted to ticks). */
  readonly data: CompiledDataLike;
  /** The PRNG state of a stream (pass to `nextU32` / `nextFloat` / `nextInt`). */
  rng(stream: RngStream): Uint32Array;
  /** Allocates the next monotonic entity id. */
  newEntityId(): number;
  emit(e: EmitInput): void;
  readonly events: SimEvent[];
}
