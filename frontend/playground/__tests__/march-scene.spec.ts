import { describe, expect, it, vi } from 'vitest';
import { ENTITY_KIND, hexDistance } from '@terra/sim';
import { MarchSceneHost } from '../content/marchScene';
import { MARCH_COUNT, MARCH_ROCKS, marchWorld } from '../content/marchSetup';
import { createState, syncURL } from '../state';

describe('playground march URL', () => {
  it('reads march=own|together and marchRock', () => {
    expect(createState(new URLSearchParams('')).march).toBeNull();
    expect(createState(new URLSearchParams('march=1')).march).toBe('own');
    expect(createState(new URLSearchParams('march=together&marchRock=1&faunaScene=mixed')).march).toBe('together');
    expect(createState(new URLSearchParams('march=together&marchRock=1&faunaScene=mixed')).marchRock).toBe(true);
    expect(createState(new URLSearchParams('march=own&faunaScene=mixed')).faunaScene).toBeNull();

    vi.stubGlobal('location', { pathname: '/playground.html' });
    vi.stubGlobal('history', { replaceState: vi.fn() });
    const state = createState(new URLSearchParams('march=together&marchRock=1'));
    const q = syncURL(state);
    expect(q.get('march')).toBe('together');
    expect(q.get('marchRock')).toBe('1');
    expect(q.has('faunaScene')).toBe(false);
  });
});

describe('playground march scene steps the sim', () => {
  it('own pace lets the tank pull ahead, and every unit finishes on its own tile', () => {
    const host = new MarchSceneHost();
    host.setActive(true, { pace: 'own', biomeKey: 'dune' });
    expect(host.getStats().units).toBe(MARCH_COUNT);
    const start = host.units();
    const tank = start.find((u) => u.id === host.tank)!;
    const hq = start.find((u) => u.kind === ENTITY_KIND.hq && u.q === tank.q)!;
    // Eight ticks: both are still walking. The tank's seat is close, so a longer sample measures a finished trip.
    host.stepTicks(8);
    const mid = host.units();
    const tankGain = hexDistance(tank.x, tank.y, mid.find((u) => u.id === tank.id)!.x, mid.find((u) => u.id === tank.id)!.y);
    const hqGain = hexDistance(hq.x, hq.y, mid.find((u) => u.id === hq.id)!.x, mid.find((u) => u.id === hq.id)!.y);
    expect(tankGain).toBeGreaterThan(hqGain + 0.4);

    let guard = 0;
    while (host.getStats().moving > 0 && guard++ < 160) host.stepTicks(1);
    const end = host.units();
    expect(new Set(end.map((u) => `${u.q},${u.r}`)).size).toBe(MARCH_COUNT);
    expect(host.getStats().moving).toBe(0);
    host.setActive(false);
  });

  it('together pace keeps the tank with the HQ, and a rock anchor is never stood on', () => {
    const host = new MarchSceneHost();
    host.setActive(true, { pace: 'together', biomeKey: 'dune' });
    const start = host.units();
    const tank = start.find((u) => u.id === host.tank)!;
    const hq = start.find((u) => u.kind === ENTITY_KIND.hq && u.q === tank.q)!;
    host.stepTicks(24);
    const mid = host.units();
    const tankGain = hexDistance(tank.x, tank.y, mid.find((u) => u.id === tank.id)!.x, mid.find((u) => u.id === tank.id)!.y);
    const hqGain = hexDistance(hq.x, hq.y, mid.find((u) => u.id === hq.id)!.x, mid.find((u) => u.id === hq.id)!.y);
    expect(Math.abs(tankGain - hqGain)).toBeLessThan(0.35);

    host.setRock(true);
    let guard = 0;
    while (host.getStats().moving > 0 && guard++ < 160) host.stepTicks(1);
    const banned = new Set(MARCH_ROCKS.map((r) => `${r.q},${r.r}`));
    for (const unit of host.units()) expect(banned.has(`${unit.q},${unit.r}`)).toBe(false);
    expect(new Set(host.units().map((u) => `${u.q},${u.r}`)).size).toBe(MARCH_COUNT);
    host.setActive(false);
  });

  it('draws a unit a quarter of the way across the tick it just stepped', () => {
    const host = new MarchSceneHost();
    host.setActive(true, { pace: 'own', biomeKey: 'dune' });
    host.stepTicks(8);
    const id = host.units()[0]!.id;
    const before = host.units().find((u) => u.id === id)!;
    const from = marchWorld(before.x, before.y);
    host.update(0.25, 1);
    const after = host.units().find((u) => u.id === id)!;
    const to = marchWorld(after.x, after.y);
    const quarter = host.drawn(id)!;
    expect(quarter.x).toBeCloseTo(from.x + 0.25 * (to.x - from.x), 5);
    expect(quarter.z).toBeCloseTo(from.z + 0.25 * (to.z - from.z), 5);
    expect(Math.hypot(to.x - from.x, to.z - from.z)).toBeGreaterThan(0.1);
    expect(Math.hypot(quarter.x - to.x, quarter.z - to.z)).toBeGreaterThan(0.05);

    host.update(0.05, 1.05);
    const half = host.drawn(id)!;
    expect(half.x).toBeCloseTo(from.x + 0.5 * (to.x - from.x), 5);
    expect(half.z).toBeCloseTo(from.z + 0.5 * (to.z - from.z), 5);
    host.setActive(false);
  });
});
