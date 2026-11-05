import type { BehaviorProfile } from '../types';
import { specialistsV1 } from './specialists-v1';

/** Scripted behaviour profiles by manifest `behaviorProfile` id. A new policy registers here and nowhere else. */
const FACTORIES: Readonly<Record<string, (overrides?: Readonly<Record<string, unknown>>) => BehaviorProfile>> = {
  'specialists-v1': specialistsV1,
};

export const behaviorIds = (): string[] => Object.keys(FACTORIES).sort();

export function createBehavior(id: string, overrides?: Readonly<Record<string, unknown>>): BehaviorProfile | null {
  const f = FACTORIES[id];
  return f ? f(overrides) : null;
}

export { SPECIALISTS_V1_PARAMS, specialistsParams } from './specialists-v1';
