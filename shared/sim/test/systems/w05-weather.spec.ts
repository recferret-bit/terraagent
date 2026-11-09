import { describe, expect, it } from 'vitest';
import { eventDef, parseWaves } from '@terra/contracts';
import {
  classifyGroundWorkTile, createRegistryPipeline, createState, DEPOSIT, ensureColonyLedger, ENTITY_KIND, ENTITY_STATE,
  getColonyPower, getHqRespawn, getWeatherState, getWorkJobsMap, hasAliveHq, hexIndex, HQ_RESPAWN_TICKS, insertRow,
  isPassableTerrain, METEOR_CRATER_TERRAFORM_MULTIPLIER, meteorCraterWorkTiles, OFFLINE_OVERLOAD_TICKS, placeSpawnedEntity,
  PREP, removeRow, rowOf, spawnColonyLanding, step, TERRAIN, TERRAFORM_TIME_TABLE,
} from '../../src';

function createW05State(id: string) {
  const state = createState({ planetId: id, planetType: 'temperate', seed: 'w05-weather', radius: 12 });
  const colony = ensureColonyLedger({ index: 0, id: 'col-0', name: 'Alpha', color: 0xff6b00, status: 'active', changedAt: 0 });
  state.colonies.push(colony);
  return { state, colony, pipeline: createRegistryPipeline({ flags: parseWaves('..05') }) };
}

function spawnEntity(state: ReturnType<typeof createState>, id: number, kind: number, q: number, r: number, hp = 400, w = 1, d = 1) {
  const row = insertRow(state.entities, id, 0);
  state.entities.cols.kind[row] = kind;
  state.entities.cols.owner[row] = 0;
  state.entities.cols.tier[row] = 1;
  placeSpawnedEntity(state.entities, row, q, r, 0);
  state.entities.cols.hp[row] = hp;
  state.entities.cols.hpMax[row] = hp;
  state.entities.cols.footprintW[row] = w;
  state.entities.cols.footprintD[row] = d;
  state.entities.cols.state[row] = ENTITY_STATE.active;
  if (state.meta.nextEntityId <= id) state.meta.nextEntityId = id + 1;
  return row;
}

describe('W05 Weather & Hazards — dev.meteor', () => {
  it('destroys all entities in a 37-hex (R=3) crater blast zone, removes trees/rocks/deposits, and makes TERRAIN.hole impassable', () => {
    const { state, pipeline } = createW05State('p-meteor');
    const hx = hexIndex(state.grid.radius);

    const centerIdx = hx.indexOf(2, 2);
    state.grid.layers.terrain[centerIdx] = TERRAIN.flat;
    state.grid.layers.prep[centerIdx] = PREP.prepared;
    state.grid.layers.deposit[centerIdx] = DEPOSIT.metals;
    state.grid.layers.richness[centerIdx] = 5000;
    state.grid.layers.height[centerIdx] = 0.1;

    const forestIdx = hx.indexOf(5, 2); // distance 3 from (2, 2)
    state.grid.layers.terrain[forestIdx] = TERRAIN.forest;
    const rockIdx = hx.indexOf(2, 5); // distance 3 from (2, 2)
    state.grid.layers.terrain[rockIdx] = TERRAIN.rock;

    spawnEntity(state, 9, ENTITY_KIND.commandHub, 0, 2, 1200, 3, 3);
    spawnEntity(state, 10, ENTITY_KIND.metalsExtractor, 2, 2, 500, 2, 2);
    spawnEntity(state, 11, ENTITY_KIND.worker, 4, 2, 120, 1, 1);
    spawnEntity(state, 12, ENTITY_KIND.worker, -6, -6, 120, 1, 1);

    const res = step(
      state,
      [{ commandId: 'm-1', colonyIndex: 0, source: 'dev', kind: 'dev.meteor', args: { q: 2, r: 2 } }],
      1,
      pipeline,
    );

    expect(res.outcomes[0].code).toBeUndefined();
    const weather = getWeatherState(state);
    expect(weather.lastMeteor?.tiles).toHaveLength(37);
    expect(weather.craters).toHaveLength(1);
    expect(weather.craters?.[0]?.tiles).toHaveLength(37);
    expect(weather.lastMeteor?.destroyedEntityIds).toEqual(expect.arrayContaining([9, 10, 11]));
    expect(weather.lastMeteor?.destroyedEntityIds).not.toContain(12);

    expect(rowOf(state.entities, 9)).toBe(-1);
    expect(rowOf(state.entities, 10)).toBe(-1);
    expect(rowOf(state.entities, 11)).toBe(-1);
    expect(rowOf(state.entities, 12)).toBeGreaterThanOrEqual(0);
    expect(isPassableTerrain(TERRAIN.hole)).toBe(false);

    for (const t of weather.lastMeteor!.tiles) {
      const idx = hx.indexOf(t.q, t.r);
      expect(state.grid.layers.terrain[idx]).toBe(TERRAIN.hole);
      expect(state.grid.layers.prep[idx]).toBe(PREP.wild);
      expect(state.grid.layers.deposit[idx]).toBe(DEPOSIT.none);
      expect(state.grid.layers.richness[idx]).toBe(0);
      expect(state.grid.layers.height[idx]).toBeLessThanOrEqual(-0.28);
      expect(state.grid.layers.changedAt[idx]).toBe(state.meta.tick);
      expect(isPassableTerrain(state.grid.layers.terrain[idx])).toBe(false);
    }

    const ev = res.events.find((e) => e.kind === 'meteorImpact');
    expect(ev).toBeDefined();
    expect(eventDef('meteorImpact').data.safeParse(ev!.data).success).toBe(true);
  });

  it('rejects out-of-bounds coordinates with out_of_bounds', () => {
    const { state, pipeline } = createW05State('p-meteor-oob');
    const res = step(
      state,
      [{ commandId: 'm-oob', colonyIndex: 0, source: 'dev', kind: 'dev.meteor', args: { q: 99, r: 99 } }],
      1,
      pipeline,
    );
    expect(res.outcomes[0].code).toBe('out_of_bounds');
  });
});

describe('W05 Weather & Hazards — whole-area meteor crater terraforming', () => {
  it('terraforms an entire 37-hex meteor crater as a single job at 10x duration and removes the crater entry', () => {
    const { state, pipeline } = createW05State('p-meteor-whole-crater');
    const hx = hexIndex(state.grid.radius);

    for (let i = 0; i < state.grid.count; i++) {
      state.grid.layers.owner[i] = 0;
      state.grid.layers.terrain[i] = TERRAIN.flat;
      state.grid.layers.prep[i] = PREP.prepared;
      state.grid.layers.height[i] = 0;
    }

    spawnEntity(state, 1, ENTITY_KIND.commandHub, -5, 2, 1200, 3, 3);
    spawnEntity(state, 2, ENTITY_KIND.worker, -2, 2, 120, 1, 1);
    step(state, [], 1, pipeline);

    step(
      state,
      [{ commandId: 'm-crater', colonyIndex: 0, source: 'dev', kind: 'dev.meteor', args: { q: 2, r: 2 } }],
      1,
      pipeline,
    );

    const weatherAfterImpact = getWeatherState(state);
    expect(weatherAfterImpact.craters).toHaveLength(1);
    const craterTiles = weatherAfterImpact.craters![0]!.tiles;
    expect(craterTiles).toHaveLength(37);
    for (const t of craterTiles) {
      expect(state.grid.layers.terrain[hx.indexOf(t.q, t.r)]).toBe(TERRAIN.hole);
    }

    const edgeTile = craterTiles.find((t) => t.q === -1 && t.r === 2) ?? craterTiles[0]!;
    expect(
      meteorCraterWorkTiles(state.grid.radius, edgeTile.q, edgeTile.r, state.grid.layers.terrain, state.blobs.weather),
    ).toHaveLength(37);

    const classified = classifyGroundWorkTile(state, 0, hx.indexOf(edgeTile.q, edgeTile.r));
    expect(classified.ok).toBe(true);
    if (classified.ok) {
      expect(classified.durationTicks).toBe(
        TERRAFORM_TIME_TABLE.hole.durationTicks * METEOR_CRATER_TERRAFORM_MULTIPLIER,
      );
    }

    const enqRes = step(
      state,
      [
        {
          commandId: 'tf-crater-1',
          colonyIndex: 0,
          source: 'player',
          kind: 'enqueueTask',
          args: { terraform: { op: 'work', intent: 'terraform', tiles: [{ q: edgeTile.q, r: edgeTile.r }] } },
        },
      ],
      1,
      pipeline,
    );
    expect(enqRes.outcomes[0].code).toBeUndefined();
    const job = getWorkJobsMap(state)['tf-crater-1'];
    expect(job?.durationTicks).toBe(TERRAFORM_TIME_TABLE.hole.durationTicks * 10);

    // Still in progress after normal 1-tile duration (80 ticks)
    step(state, [], 80, pipeline);
    expect(getWeatherState(state).craters).toHaveLength(1);

    // Finishes after full 10x duration (800 ticks total work)
    step(state, [], 725, pipeline);

    for (const t of craterTiles) {
      const idx = hx.indexOf(t.q, t.r);
      expect(state.grid.layers.terrain[idx]).toBe(TERRAIN.flat);
      expect(state.grid.layers.prep[idx]).toBe(PREP.prepared);
      expect(state.grid.layers.height[idx]).toBeCloseTo(0, 3);
    }
    expect(getWeatherState(state).craters).toHaveLength(0);
  });
});

describe('W05 Weather & Hazards — dev.lightning, dev.rain, dev.storm', () => {
  it('strikes 4 hexes, turns land into impassable TERRAIN.hole aftermath sites, heavily damages buildings, overloads electricity offline, and recovers after 75 ticks', () => {
    const { state, pipeline } = createW05State('p-lightning');
    const hx = hexIndex(state.grid.radius);

    const strikeCenterIdx = hx.indexOf(4, 1);
    const strikeTreeIdx = hx.indexOf(5, 1);
    state.grid.layers.terrain[strikeCenterIdx] = TERRAIN.flat;
    state.grid.layers.deposit[strikeCenterIdx] = DEPOSIT.metals;
    state.grid.layers.richness[strikeCenterIdx] = 4000;
    state.grid.layers.terrain[strikeTreeIdx] = TERRAIN.forest;

    spawnEntity(state, 1, ENTITY_KIND.commandHub, 0, 0, 1200, 3, 3);
    spawnEntity(state, 2, ENTITY_KIND.solar, 3, 0, 400, 2, 2);
    spawnEntity(state, 3, ENTITY_KIND.metalsExtractor, 4, 1, 500, 2, 2);

    step(state, [], 1, pipeline);
    expect(state.entities.cols.state[rowOf(state.entities, 3)]).toBe(ENTITY_STATE.active);

    const strikeRes = step(
      state,
      [{ commandId: 'l-1', colonyIndex: 0, source: 'dev', kind: 'dev.lightning', args: { q: 4, r: 1 } }],
      1,
      pipeline,
    );
    expect(strikeRes.outcomes[0].code).toBeUndefined();

    const weather = getWeatherState(state);
    expect(weather.lastLightning?.tiles).toHaveLength(4);
    expect(weather.lightningSites).toHaveLength(1);
    expect(weather.lightningSites?.[0]?.tiles).toHaveLength(4);
    expect(weather.lastLightning?.damagedEntityIds).toContain(3);
    expect(weather.lastLightning?.overloadedEntityIds).toContain(3);

    for (const t of weather.lastLightning!.tiles) {
      const idx = hx.indexOf(t.q, t.r);
      expect(state.grid.layers.terrain[idx]).toBe(TERRAIN.hole);
      expect(state.grid.layers.prep[idx]).toBe(PREP.wild);
      expect(state.grid.layers.deposit[idx]).toBe(DEPOSIT.none);
      expect(state.grid.layers.richness[idx]).toBe(0);
      expect(isPassableTerrain(state.grid.layers.terrain[idx])).toBe(false);
    }

    const extRow = rowOf(state.entities, 3);
    expect(state.entities.cols.hp[extRow]).toBeLessThan(500);
    expect(state.entities.cols.hp[extRow]).toBeGreaterThanOrEqual(1);
    expect(state.entities.cols.state[extRow]).toBe(ENTITY_STATE.offlineOverload);

    const powerDuring = getColonyPower(state, 0);
    expect(powerDuring.entityPower?.[3]?.state).toBe('offline');
    expect(powerDuring.entityPower?.[3]?.reason).toBe('offline: lightning overload');
    expect((powerDuring.entityPower?.[3] as { overloaded?: boolean })?.overloaded).toBe(true);

    const lEv = strikeRes.events.find((e) => e.kind === 'lightningStrike');
    const pEv = strikeRes.events.find((e) => e.kind === 'powerOverload');
    expect(eventDef('lightningStrike').data.safeParse(lEv!.data).success).toBe(true);
    expect(eventDef('powerOverload').data.safeParse(pEv!.data).success).toBe(true);

    step(state, [], OFFLINE_OVERLOAD_TICKS, pipeline);
    expect(getWeatherState(state).overloadUntilByEntity[3]).toBeUndefined();
    expect(state.entities.cols.state[rowOf(state.entities, 3)]).toBe(ENTITY_STATE.active);
    expect(getColonyPower(state, 0).entityPower?.[3]?.state).toBe('online');
  });
});

describe('W05 Weather & Hazards — dev.rain and dev.storm solar output reduction', () => {
  it('dev.rain and dev.storm configure rain intensity, solar daylight reduction (0.72 / 0.55 / 0.45), wind boost, and lightning', () => {
    const { state, pipeline } = createW05State('p-storm-rain');
    spawnEntity(state, 1, ENTITY_KIND.commandHub, 0, 0, 1200, 3, 3);
    spawnEntity(state, 2, ENTITY_KIND.solar, 3, 0, 400, 2, 2);

    step(state, [], 1, pipeline);
    const clearPower = getColonyPower(state, 0);
    const baseSolarGross = clearPower.solarGrossPerS;
    expect(clearPower.daylight).toBe(1);
    expect(baseSolarGross).toBeGreaterThan(0);

    step(
      state,
      [{ commandId: 'r-minor', colonyIndex: 0, source: 'dev', kind: 'dev.rain', args: { level: 'minor' } }],
      1,
      pipeline,
    );
    expect(getWeatherState(state).rainLevel).toBe('minor');
    expect(getWeatherState(state).rainIntensity).toBeCloseTo(0.35, 3);
    const minorRainPower = getColonyPower(state, 0);
    expect(minorRainPower.daylight).toBe(0.72);
    expect(minorRainPower.solarGrossPerS).toBeCloseTo(baseSolarGross * 0.72, 2);

    step(
      state,
      [{ commandId: 'r-heavy', colonyIndex: 0, source: 'dev', kind: 'dev.rain', args: { level: 'heavy' } }],
      1,
      pipeline,
    );
    expect(getWeatherState(state).rainLevel).toBe('heavy');
    const heavyRainPower = getColonyPower(state, 0);
    expect(heavyRainPower.daylight).toBe(0.55);
    expect(heavyRainPower.solarGrossPerS).toBeCloseTo(baseSolarGross * 0.55, 2);

    const stormOn = step(
      state,
      [{ commandId: 's-on', colonyIndex: 0, source: 'dev', kind: 'dev.storm', args: { active: true, lightning: false } }],
      1,
      pipeline,
    );
    const wOn = getWeatherState(state);
    expect(wOn.stormActive).toBe(true);
    expect(wOn.rainLevel).toBe('heavy');
    expect((state.blobs.environment?.value as { stormDaylightMult?: number })?.stormDaylightMult).toBe(0.45);
    const stormPower = getColonyPower(state, 0);
    expect(stormPower.daylight).toBe(0.45);
    expect(stormPower.solarGrossPerS).toBeCloseTo(baseSolarGross * 0.45, 2);
    expect(eventDef('stormStarted').data.safeParse(stormOn.events.find((e) => e.kind === 'stormStarted')!.data).success).toBe(true);

    const stormOff = step(
      state,
      [{ commandId: 's-off', colonyIndex: 0, source: 'dev', kind: 'dev.storm', args: { active: false } }],
      1,
      pipeline,
    );
    expect(getWeatherState(state).stormActive).toBe(false);
    expect(getWeatherState(state).rainLevel).toBe('none');
    expect(getColonyPower(state, 0).daylight).toBe(1);
    expect(eventDef('stormEnded').data.safeParse(stormOff.events.find((e) => e.kind === 'stormEnded')!.data).success).toBe(true);
  });
});

describe('W05 Weather & Hazards — dev.twister', () => {
  it('enforces high wind (>=120%) + minor rain gate, then rises, moves, uproots trees, sucks up units (fall & die), and damages buildings', () => {
    const { state, pipeline } = createW05State('p-twister');
    const hx = hexIndex(state.grid.radius);

    const rej1 = step(
      state,
      [{ commandId: 'tw-rej-1', colonyIndex: 0, source: 'dev', kind: 'dev.twister', args: { q: 0, r: 0 } }],
      1,
      pipeline,
    );
    expect(rej1.outcomes[0].code).toBe('weather_conditions_not_met');

    step(
      state,
      [
        { commandId: 'w-130', colonyIndex: 0, source: 'dev', kind: 'dev.setwind', args: { pct: 130 } },
        { commandId: 'r-heavy', colonyIndex: 0, source: 'dev', kind: 'dev.rain', args: { level: 'heavy' } },
      ],
      1,
      pipeline,
    );
    const rej2 = step(
      state,
      [{ commandId: 'tw-rej-2', colonyIndex: 0, source: 'dev', kind: 'dev.twister', args: { q: 0, r: 0 } }],
      1,
      pipeline,
    );
    expect(rej2.outcomes[0].code).toBe('weather_conditions_not_met');

    step(
      state,
      [{ commandId: 'r-minor', colonyIndex: 0, source: 'dev', kind: 'dev.rain', args: { level: 'minor' } }],
      1,
      pipeline,
    );

    const treeIdx0 = hx.indexOf(0, 0);
    const treeIdx2 = hx.indexOf(2, 0);
    const treeIdxRing2Side = hx.indexOf(0, 2); // distance 2 from (0, 0)
    state.grid.layers.terrain[treeIdx0] = TERRAIN.forest;
    state.grid.layers.terrain[treeIdx2] = TERRAIN.forest;
    state.grid.layers.terrain[treeIdxRing2Side] = TERRAIN.forest;

    spawnEntity(state, 20, ENTITY_KIND.worker, 1, 0, 120, 1, 1);
    spawnEntity(state, 21, ENTITY_KIND.solar, 2, 0, 40, 2, 2);

    const okRes = step(
      state,
      [{ commandId: 'tw-ok', colonyIndex: 0, source: 'dev', kind: 'dev.twister', args: { q: 0, r: 0, dirDeg: 0 } }],
      1,
      pipeline,
    );
    expect(okRes.outcomes[0].code).toBeUndefined();
    expect(eventDef('twisterStarted').data.safeParse(okRes.events.find((e) => e.kind === 'twisterStarted')!.data).success).toBe(true);

    let weather = getWeatherState(state);
    const initialDirRad = weather.activeTwisters[0].dirRad;
    expect(state.grid.layers.terrain[treeIdx0]).toBe(TERRAIN.flat);
    expect(state.grid.layers.terrain[treeIdxRing2Side]).toBe(TERRAIN.flat);
    expect(weather.activeTwisters[0].suckedUnits.some((u) => u.id === 20 && !u.dead)).toBe(true);

    const seenDirs = new Set<number>([initialDirRad]);
    for (let i = 0; i < 12; i++) {
      step(state, [], 1, pipeline);
      const curTwister = getWeatherState(state).activeTwisters[0];
      if (curTwister) seenDirs.add(curTwister.dirRad);
    }

    weather = getWeatherState(state);
    expect(seenDirs.size).toBeGreaterThan(2);
    expect(weather.activeTwisters[0].x).toBeGreaterThan(1.5);
    expect(state.grid.layers.terrain[treeIdx2]).toBe(TERRAIN.flat);
    expect(weather.activeTwisters[0].suckedUnits.find((u) => u.id === 20)?.dead).toBe(true);
    expect(rowOf(state.entities, 20)).toBe(-1);
    expect(rowOf(state.entities, 21)).toBe(-1);
  });
});

describe('W05 Weather & Hazards — Pod destruction on meteor hit & systematic HQ respawn', () => {
  it('destroys a landed ENTITY_KIND.pod on meteor impact, relocates respawn target if bombed, and lands a replacement pod after 30s', () => {
    const state = createState({ planetId: 'p-pod-meteor', planetType: 'temperate', seed: 'w05-pod', radius: 12 });
    const pipeline = createRegistryPipeline({ flags: parseWaves('..05') });
    const landed = spawnColonyLanding(state, { colonyId: 0, q: 0, r: 0 });
    expect(landed.ok).toBe(true);
    if (!landed.ok) return;
    step(state, [], 35, pipeline);
    expect(hasAliveHq(state, 0)).toBe(true);
    expect(rowOf(state.entities, landed.podEntityId)).toBeGreaterThanOrEqual(0);

    const res = step(
      state,
      [{ commandId: 'm-pod', colonyIndex: 0, source: 'dev', kind: 'dev.meteor', args: { q: 0, r: 0 } }],
      1,
      pipeline,
    );
    expect(res.outcomes[0].code).toBeUndefined();
    expect(rowOf(state.entities, landed.podEntityId)).toBe(-1);
    expect(getWeatherState(state).lastMeteor?.destroyedEntityIds).toContain(landed.podEntityId);
    expect(hasAliveHq(state, 0)).toBe(false);
    expect(res.events.some((e) => e.kind === 'hqDestroyed')).toBe(true);

    const firstTarget = getHqRespawn(state, 0)!;
    expect(firstTarget).toBeDefined();
    step(
      state,
      [{ commandId: 'm-reloc', colonyIndex: 0, source: 'dev', kind: 'dev.meteor', args: { q: firstTarget.q, r: firstTarget.r } }],
      1,
      pipeline,
    );
    const secondTarget = getHqRespawn(state, 0)!;
    expect(secondTarget.q !== firstTarget.q || secondTarget.r !== firstTarget.r).toBe(true);

    step(state, [], HQ_RESPAWN_TICKS, pipeline);
    step(state, [], 40, pipeline);
    expect(hasAliveHq(state, 0)).toBe(true);
  });

  it('systematically triggers hqRespawn and hqDestroyed on non-meteor HQ loss (twister or direct removal after pod removal)', () => {
    const state = createState({ planetId: 'p-hq-twister', planetType: 'temperate', seed: 'w05-hq-tw', radius: 12 });
    const pipeline = createRegistryPipeline({ flags: parseWaves('..05') });
    const landed = spawnColonyLanding(state, { colonyId: 0, q: 0, r: 0 });
    expect(landed.ok).toBe(true);
    if (!landed.ok) return;
    step(state, [], 35, pipeline);

    // Destroy only the pod first (move HQ outside the blast radius)
    const hqRow = state.entities.cols.kind.findIndex((k, r) => r < state.entities.count && k === ENTITY_KIND.hq);
    state.entities.cols.q[hqRow] = 6;
    state.entities.cols.r[hqRow] = 0;
    step(state, [{ commandId: 'm-only-pod', colonyIndex: 0, source: 'dev', kind: 'dev.meteor', args: { q: 0, r: 0 } }], 1, pipeline);
    expect(rowOf(state.entities, landed.podEntityId)).toBe(-1);
    expect(hasAliveHq(state, 0)).toBe(true);

    // Now kill HQ with a twister at (6, 0)
    const twRes = step(
      state,
      [
        { commandId: 'w-135', colonyIndex: 0, source: 'dev', kind: 'dev.setwind', args: { pct: 135 } },
        { commandId: 'r-min', colonyIndex: 0, source: 'dev', kind: 'dev.rain', args: { level: 'minor' } },
        { commandId: 'tw-hq', colonyIndex: 0, source: 'dev', kind: 'dev.twister', args: { q: 6, r: 0, dirDeg: 0 } },
      ],
      1,
      pipeline,
    );
    expect(twRes.outcomes[2].code).toBeUndefined();
    expect(hasAliveHq(state, 0)).toBe(false);
    expect(getHqRespawn(state, 0)).toMatchObject({ lastHqQ: 6, lastHqR: 0 });
    expect(twRes.events.some((e) => e.kind === 'hqDestroyed')).toBe(true);

    // Also verify direct HQ removal after respawn completes triggers another respawn
    step(state, [], HQ_RESPAWN_TICKS, pipeline);
    step(state, [], 40, pipeline);
    expect(hasAliveHq(state, 0)).toBe(true);
    const newHqRow = state.entities.cols.kind.findIndex((k, r) => r < state.entities.count && k === ENTITY_KIND.hq);
    removeRow(state.entities, state.entities.cols.id[newHqRow], state.meta.tick);
    const directRes = step(state, [], 1, pipeline);
    expect(getHqRespawn(state, 0)).toBeDefined();
    expect(directRes.events.some((e) => e.kind === 'hqDestroyed')).toBe(true);
  });
});
