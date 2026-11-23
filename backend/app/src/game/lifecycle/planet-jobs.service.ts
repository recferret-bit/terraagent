import { Inject, Injectable, Optional } from '@nestjs/common';
import type { JobRetryOptions } from '../../jobs/job-queue.port';
import { JobsService } from '../../jobs/jobs.service';
import { deadLetterOf, LOOP_RETRY, type JobRegistration } from '../../jobs/recurring';
import { GamePlanets } from '../game-planets.service';

export interface PlanetJobDef {
  /** Queue name prefix, e.g. `planet.lifecycle`. */
  readonly name: string;
  readonly everyMs: number;
  readonly run: (planetId: string) => Promise<unknown>;
  /** Planets of this process worked at once. Default 2. */
  readonly concurrency?: number;
  readonly retry?: JobRetryOptions;
  /** Planets this job skips (checked when the sweep enqueues). */
  readonly eligible?: (planetId: string) => boolean;
}

export interface PlanetJobData {
  readonly planetId: string;
}

/**
 * Planet-scoped jobs (3.8, 4): one job per planet at a time, only on the lease holder. Every sim-hosting process
 * owns an `instance` queue: a sweep enqueues one job per planet it has loaded (singleton key = planet id, `stately`:
 * one waiting and one running per planet), and its worker runs them while the planet is still loaded here. A planet
 * that moved to another replica is skipped; that replica's sweep picks it up.
 */
@Injectable()
export class PlanetJobsService {
  constructor(
    @Inject(GamePlanets) private readonly planets: Pick<GamePlanets, 'loadedIds' | 'isLoaded'>,
    @Optional() @Inject(JobsService) private readonly jobs?: JobsService,
  ) {}

  register(def: PlanetJobDef): JobRegistration {
    const jobs = this.jobs;
    if (!jobs || !jobs.hostsSim) return { stop: async () => undefined };
    const queue = jobs.queueFor(def.name, 'instance');
    const worker = jobs.worker<PlanetJobData>(
      { name: queue, policy: 'stately', ...(def.retry ?? LOOP_RETRY), deadLetter: deadLetterOf(def.name) },
      { concurrency: def.concurrency ?? 2 },
      async ({ data }) => {
        if (this.planets.isLoaded(data.planetId)) await def.run(data.planetId);
      },
    );
    const sweep = jobs.recurring({
      name: `${def.name}.sweep`,
      scope: 'instance',
      schedule: { everyMs: def.everyMs },
      run: () => this.fanOut(queue, def),
    });
    return { stop: async () => { await sweep.stop(); await worker.stop(); } };
  }

  /** Enqueues one job per locally loaded planet; a planet with a job still waiting is coalesced. */
  async fanOut(queue: string, def: Pick<PlanetJobDef, 'eligible'>): Promise<number> {
    let queued = 0;
    for (const planetId of this.planets.loadedIds()) {
      if (def.eligible && !def.eligible(planetId)) continue;
      if (await this.jobs?.port.enqueue<PlanetJobData>(queue, { planetId }, { singletonKey: planetId })) queued++;
    }
    return queued;
  }
}
