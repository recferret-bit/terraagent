import 'reflect-metadata';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/bus/event-bus.js';
import type { AppEnv } from '../../src/core/tokens.js';
import type { FlagsService } from '../../src/flags/flags.service.js';
import { loadPolicy } from '../../src/market/guild/guild-plan.js';
import { GuildVisitPublisher, type GuildPush } from '../../src/market/guild/visit/guild-visit.publisher.js';
import { GuildVisitRepository } from '../../src/market/guild/visit/guild-visit.repository.js';
import { GuildVisitService } from '../../src/market/guild/visit/guild-visit.service.js';
import { scheduleAt, type ScheduleInput } from '../../src/market/guild/visit/schedule.js';

const PLANET = 'pl_guildvisit';
const NPC = 'kestrel';
const on = { has: (wave: string) => wave === 'W15' } as unknown as FlagsService;
const off = { has: () => false } as unknown as FlagsService;

let db: TestDatabase;
let svc: GuildVisitService;
let bus: EventBus;
let pushed: GuildPush[];
let env: AppEnv;
let spec: ScheduleInput;
let arrive1: number;

beforeAll(async () => {
  db = await createTestDatabase();
  env = { NODE_ENV: 'test', DATABASE_URL: db.url } as AppEnv;
  bus = new EventBus();
  pushed = [];
  bus.on('guild.arrived', (ev) => pushed.push({ t: 'guild.arrived', d: ev.payload }), { module: 'test' });
  bus.on('guild.departed', (ev) => pushed.push({ t: 'guild.departed', d: ev.payload }), { module: 'test' });
  svc = new GuildVisitService(on, new GuildVisitRepository(db.prisma), new GuildVisitPublisher(bus), env);
  const policy = loadPolicy((wave) => wave === 'W15');
  spec = {
    seed: policy.policyVersion,
    npcId: NPC,
    planetId: PLANET,
    route: ['loop-local'],
    dockWindowMs: policy.dockWindowS * 1000,
    visitGapMs: policy.visitGapS * 1000,
    enabled: true,
  };
  arrive1 = scheduleAt(spec, 1_700_000_000_000)!.arriveAt;
});

afterAll(async () => {
  await db?.drop();
});

describe('Guild visits on Postgres (W15-09)', () => {
  it('W15 off writes no row and pushes nothing', async () => {
    const before = await db.prisma.guildVisit.count();
    const seen: string[] = [];
    const quiet = new EventBus();
    quiet.on('guild.arrived', () => seen.push('arrived'), { module: 'test' });
    quiet.on('guild.departed', () => seen.push('departed'), { module: 'test' });
    const silent = new GuildVisitService(off, new GuildVisitRepository(db.prisma), new GuildVisitPublisher(quiet), env);
    expect(await silent.advance(PLANET, arrive1, NPC)).toEqual([]);
    expect(await silent.scheduleExtraVisit(PLANET)).toBeNull();
    expect(await db.prisma.guildVisit.count()).toBe(before);
    expect(seen).toEqual([]);
  });

  it('warps through two visits: arrived then departed, and a second tick does not add a row', async () => {
    const dock = spec.dockWindowMs;
    const arrive2 = arrive1 + dock + spec.visitGapMs;
    await svc.advance(PLANET, arrive1, NPC);
    expect(kinds(pushed)).toEqual(['guild.arrived']);
    expect(await cadenceCount()).toBe(1);

    await svc.advance(PLANET, arrive1 + 1_000, NPC);
    expect(await cadenceCount()).toBe(1);
    expect(pushed).toHaveLength(1);

    await svc.advance(PLANET, arrive1 + dock, NPC);
    expect(kinds(pushed)).toEqual(['guild.arrived', 'guild.departed']);

    await svc.advance(PLANET, arrive2, NPC);
    expect(await cadenceCount()).toBe(2);
    await svc.advance(PLANET, arrive2, NPC);
    expect(await cadenceCount()).toBe(2);
    expect(await db.prisma.guildVisit.count()).toBe(2);

    await svc.advance(PLANET, arrive2 + dock, NPC);
    expect(kinds(pushed)).toEqual(['guild.arrived', 'guild.departed', 'guild.arrived', 'guild.departed']);
    const rows = await db.prisma.guildVisit.findMany({
      where: { npcId: NPC, kind: 'cadence' },
      orderBy: { arriveAt: 'asc' },
    });
    expect(rows.map((row) => row.arriveAt.getTime())).toEqual([arrive1, arrive2]);
    expect(rows.every((row) => row.arriveAt < row.departAt && row.status === 'departed')).toBe(true);
    expect(rows[0]!.departAt.getTime() - rows[0]!.arriveAt.getTime()).toBe(dock);
    expect(rows[0]!.offers).toEqual([]);
    expect(pushed[0]!.d).toMatchObject({
      shipId: NPC,
      planetId: PLANET,
      npcId: NPC,
      name: 'Kestrel',
      departAt: arrive1 + dock,
      offers: [],
    });
    expect(pushed[1]!.d).toMatchObject({ shipId: NPC, planetId: PLANET, npcId: NPC });
  });

  it('an extra visit does not move the next seeded arrival', async () => {
    const arrive2 = arrive1 + spec.dockWindowMs + spec.visitGapMs;
    const extra = await svc.scheduleExtraVisit(PLANET);
    expect(extra?.t).toBe('guild.arrived');
    const rows = await db.prisma.guildVisit.findMany({ orderBy: { arriveAt: 'asc' } });
    const cadence = rows.filter((row) => row.kind === 'cadence');
    const added = rows.filter((row) => row.kind === 'extra');
    expect(cadence.map((row) => row.arriveAt.getTime())).toEqual([arrive1, arrive2]);
    expect(added).toHaveLength(1);
    expect(added[0]!.departAt.getTime() - added[0]!.arriveAt.getTime()).toBe(spec.dockWindowMs);

    const arrive3 = arrive2 + spec.dockWindowMs + spec.visitGapMs;
    await svc.advance(PLANET, arrive3, NPC);
    const after = await db.prisma.guildVisit.findMany({ where: { kind: 'cadence' }, orderBy: { arriveAt: 'asc' } });
    expect(after.map((row) => row.arriveAt.getTime())).toEqual([arrive1, arrive2, arrive3]);
  });
});

function kinds(events: readonly GuildPush[]): string[] {
  return events.map((event) => event.t);
}

function cadenceCount(): Promise<number> {
  return db.prisma.guildVisit.count({ where: { npcId: NPC, planetId: PLANET, kind: 'cadence' } });
}
