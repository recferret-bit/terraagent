import { Inject, Injectable, Optional } from '@nestjs/common';
import type { JobRetryOptions, QueueDefinition } from '../../jobs/job-queue.port';
import { JobsService } from '../../jobs/jobs.service';
import { LOOP_DELETE_AFTER_S, LOOP_RETRY, loopExpireSeconds, type JobRegistration } from '../../jobs/recurring';
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

/** An idle planet worker looks for jobs this often (two polls a second per worker slot). */
export const PLANET_JOB_POLL_MS = 500;

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

  /** True when planet jobs actually run in this process (a job queue exists and this process hosts sims). */
  get enabled(): boolean {
    return Boolean(this.jobs?.hostsSim);
  }

  register(def: PlanetJobDef): JobRegistration {
    const jobs = this.jobs;
    if (!jobs || !jobs.hostsSim) return { stop: async () => undefined };
    const queueDef: QueueDefinition = {
      name: jobs.queueFor(def.name, 'instance'), policy: 'stately', ...(def.retry ?? LOOP_RETRY),
      expireInSeconds: loopExpireSeconds(def.everyMs), deleteAfterSeconds: LOOP_DELETE_AFTER_S,
    };
    const running = new Set<string>();
    const worker = jobs.worker<PlanetJobData>(
      queueDef,
      { concurrency: def.concurrency ?? 2, pollMs: PLANET_JOB_POLL_MS },
      async ({ data }) => {
        // One run per planet at a time in this process, even if the queue hands the planet out twice (a job that
        // outlived its expiry is failed by the queue while its handler is still running).
        if (running.has(data.planetId) || !this.planets.isLoaded(data.planetId)) return;
        running.add(data.planetId);
        try {
          await def.run(data.planetId);
        } finally {
          running.delete(data.planetId);
        }
      },
    );
    const sweep = jobs.recurring({
      name: `${def.name}.sweep`,
      scope: 'instance',
      schedule: { everyMs: def.everyMs },
      run: () => this.fanOut(queueDef, def),
    });
    return { stop: async () => { await sweep.stop(); await worker.stop(); } };
  }

  /**
   * Enqueues one job per locally loaded planet; a planet with a job still waiting is coalesced. The queue is defined
   * first (idempotent): an enqueue into a queue that does not exist yet would create it with the default policy, and
   * a planet could then pile up and overlap jobs.
   */
  async fanOut(queue: QueueDefinition, def: Pick<PlanetJobDef, 'eligible'>): Promise<number> {
    if (!this.jobs) return 0;
    await this.jobs.define(queue);
    let queued = 0;
    for (const planetId of this.planets.loadedIds()) {
      if (def.eligible && !def.eligible(planetId)) continue;
      if (await this.jobs.port.enqueue<PlanetJobData>(queue.name, { planetId }, { singletonKey: planetId })) queued++;
    }
    return queued;
  }
}
