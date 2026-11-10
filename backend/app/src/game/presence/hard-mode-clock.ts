import { Injectable } from '@nestjs/common';
import type { ColonyEliminatedCause } from '@terra/contracts';

/** Wall-clock start of hard mode for one away colony. W09-19 reads `get`. Process memory: a restart clears it. */
export interface HardModeMark {
  readonly planetId: string;
  readonly colonyId: string;
  readonly colonyIndex: number;
  readonly startedAtMs: number;
  readonly atTick: number;
  readonly cause: ColonyEliminatedCause;
}

const keyOf = (planetId: string, colonyId: string): string => `${planetId}\0${colonyId}`;

/** First elimination while away wins. A later call does not move `startedAtMs`. */
@Injectable()
export class HardModeClock {
  private readonly marks = new Map<string, HardModeMark>();

  start(mark: HardModeMark): HardModeMark {
    const key = keyOf(mark.planetId, mark.colonyId);
    const prev = this.marks.get(key);
    if (prev) return prev;
    this.marks.set(key, mark);
    return mark;
  }

  get(planetId: string, colonyId: string): HardModeMark | undefined {
    return this.marks.get(keyOf(planetId, colonyId));
  }
}
