import { describe, expect, it } from 'vitest';
import type { FlagsService } from '../../src/flags/flags.service.js';
import { loadPolicy } from '../../src/market/guild/guild-plan.js';
import { GuildVisitError } from '../../src/market/guild/visit/guild-visit.error.js';
import type { GuildVisitPublisher } from '../../src/market/guild/visit/guild-visit.publisher.js';
import type { GuildVisitRepository } from '../../src/market/guild/visit/guild-visit.repository.js';
import { GuildVisitService } from '../../src/market/guild/visit/guild-visit.service.js';
import {
  dueWindows,
  extraVisit,
  scheduleAt,
  upcomingVisits,
  type ScheduleInput,
} from '../../src/market/guild/visit/schedule.js';

const NOW = 1_700_000_000_000;
const DOCK = 720_000;
const GAP = 1_800_000;
const off = { has: () => false } as unknown as FlagsService;

function input(over: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    seed: 'guild-mock-1',
    npcId: 'kestrel',
    planetId: 'pl_test',
    route: ['loop-local'],
    dockWindowMs: DOCK,
    visitGapMs: GAP,
    enabled: true,
    ...over,
  };
}

describe('Guild visit schedule (W15-09)', () => {
  it('two visits have arrive before depart, then the ship is en route back to the same planet', () => {
    const policy = loadPolicy((wave) => wave === 'W15');
    const spec = input({
      seed: policy.policyVersion,
      dockWindowMs: policy.dockWindowS * 1000,
      visitGapMs: policy.visitGapS * 1000,
    });
    const visits = upcomingVisits(spec, NOW, 2);
    expect(visits).toHaveLength(2);
    expect(visits[0]!.arriveAt).toBeLessThan(visits[0]!.departAt);
    expect(visits[1]!.arriveAt).toBeLessThan(visits[1]!.departAt);
    expect(visits[0]!.departAt).toBeLessThan(visits[1]!.arriveAt);
    expect(upcomingVisits(spec, NOW, 2)).toEqual(visits);

    const between = scheduleAt(spec, visits[0]!.departAt);
    expect(between).toMatchObject({ phase: 'enroute', arriveAt: visits[1]!.arriveAt, nextPlanetId: 'pl_test' });
    expect(scheduleAt(spec, visits[0]!.arriveAt)).toMatchObject({ phase: 'docked', arriveAt: visits[0]!.arriveAt });
    const routed = { ...spec, planetId: 'pl_a', route: ['pl_a', 'pl_b'] };
    const [stop] = upcomingVisits(routed, NOW, 1);
    expect(scheduleAt(routed, stop!.departAt)).toMatchObject({ phase: 'enroute', nextPlanetId: 'pl_b' });
    expect(upcomingVisits(input({ npcId: 'vanguard' }), NOW, 1)[0]!.arriveAt).not.toBe(visits[0]!.arriveAt);
    const again = dueWindows(spec, visits[0]!.arriveAt, visits[0]!.arriveAt + 1_000);
    expect(again.map((w) => w.arriveAt)).toEqual([visits[0]!.arriveAt]);
  });

  it('W15 off yields no visits and the service does not write or push', async () => {
    expect(upcomingVisits(input({ enabled: false }), NOW, 2)).toEqual([]);
    expect(scheduleAt(input({ enabled: false }), NOW)).toBeNull();
    expect(dueWindows(input({ enabled: false }), null, NOW)).toEqual([]);
    const publisher = {
      arrived: () => {
        throw new Error('push');
      },
      departed: () => {
        throw new Error('push');
      },
    };
    const repo = {
      latestCadence: () => {
        throw new Error('read');
      },
    };
    const svc = new GuildVisitService(
      off,
      repo as unknown as GuildVisitRepository,
      publisher as unknown as GuildVisitPublisher,
    );
    expect(await svc.advance('pl_test', NOW, 'kestrel')).toEqual([]);
    expect(await svc.tick('pl_test')).toEqual([]);
    expect(await svc.scheduleExtraVisit('pl_test')).toBeNull();
  });

  it('dock is exactly 720_000 ms and a zero-length extra visit is rejected', () => {
    const [visit] = upcomingVisits(input(), NOW, 1);
    expect(visit!.departAt - visit!.arriveAt).toBe(720_000);
    expect(loadPolicy((wave) => wave === 'W15').dockWindowS * 1000).toBe(720_000);
    const extra = extraVisit({ npcId: 'kestrel', planetId: 'pl_test', nowMs: NOW, dockWindowMs: 720_000 });
    expect(extra.departAt - extra.arriveAt).toBe(720_000);
    expect(() => extraVisit({ npcId: 'kestrel', planetId: 'pl_test', nowMs: NOW, dockWindowMs: 0 })).toThrow(
      GuildVisitError,
    );
    try {
      extraVisit({ npcId: 'kestrel', planetId: 'pl_test', nowMs: NOW, dockWindowMs: 0 });
    } catch (e) {
      expect(e).toMatchObject({ errorCode: 'zero_visit' });
    }
  });
});
