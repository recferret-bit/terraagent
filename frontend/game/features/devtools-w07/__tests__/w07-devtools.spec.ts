// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { parseWaves, type SimEventWire } from '@terra/contracts';
import { tileXZ } from '@terra/render/planets/hex';
import {
  applyDamage,
  createPlanet,
  ENTITY_KIND,
  ENTITY_STATE,
  fireProjectile,
  getFaunaHivesState,
  getUnitStance,
  isColonyGodMode,
  rowOf,
  spawnHqUnit,
  stepProjectileImpacts,
} from '@terra/sim';
import type { FeatureContext } from '../../../core/registry/types';
import { CommandRunner } from '../../../dev/console/runner';
import type { CommandResult } from '../../../net/commandBus';
import { LocalHost } from '../../../store/local/LocalHost';
import { builtPlanetSource } from '../../../store/local/planetSource';
import devtoolsW07, { createHitDebugRenderer } from '../index';

function makeLocalHarness() {
  const flags = parseWaves('..07').list;
  const host = new LocalHost({
    flags,
    source: builtPlanetSource('w07-devtools-test', flags, () => {
      const planet = createPlanet({ type: 'flat', seed: 'w07-devtools-seed', radius: 24 });
      spawnHqUnit(planet, { owner: 0, q: 0, r: 0 });
      return planet;
    }),
  });

  const scene = new THREE.Scene();
  const serverEventListeners: Array<(events: readonly SimEventWire[]) => void> = [];
  const renderEventListeners: Array<(events: readonly SimEventWire[]) => void> = [];

  let cmdSeq = 0;
  const sendCommand = async (kind: string, args: unknown): Promise<CommandResult> => {
    const commandId = `dev_cmd_${++cmdSeq}`;
    host.sim.submit({
      colonyIndex: 0,
      source: 'dev',
      commandId,
      kind,
      args,
    });
    const stepRes = host.sim.step(1);
    host.sync(false);
    if (stepRes.events.length > 0) {
      const wire = stepRes.events as unknown as readonly SimEventWire[];
      for (const fn of serverEventListeners) fn(wire);
    }
    const out = stepRes.outcomes.find((o) => o.commandId === commandId) ?? stepRes.outcomes[0];
    if (out?.code) {
      return { ok: false, code: out.code };
    }
    return { ok: true, appliedAtTick: out?.appliedAtTick ?? host.tick };
  };

  const ctx: FeatureContext = {
    flags: new Set(flags),
    host: 'local',
    services: {
      track: () => {},
      sendCommand,
      store: {
        get latest() {
          return host.store.latest;
        },
        onView: (fn) => host.store.onView(fn),
        onServerEvents: (fn) => {
          serverEventListeners.push(fn);
          return () => {
            const idx = serverEventListeners.indexOf(fn);
            if (idx >= 0) serverEventListeners.splice(idx, 1);
          };
        },
        onRenderEvents: (fn) => {
          renderEventListeners.push(fn);
          return () => {
            const idx = renderEventListeners.indexOf(fn);
            if (idx >= 0) renderEventListeners.splice(idx, 1);
          };
        },
      },
      scene3d: {
        scene,
        tileToWorld(x: number, y: number) {
          const [wx, wz] = tileXZ(x, y);
          return { x: wx, y: 0, z: wz };
        },
        biomeKey: () => 'forestRock',
      },
    },
  };

  const runner = new CommandRunner([devtoolsW07], ctx);
  const run = async (line: string): Promise<string> => {
    const res = await runner.run(line);
    return res?.kind === 'text' ? res.text : '';
  };

  return {
    host,
    scene,
    ctx,
    run,
    emitServerEvents(events: readonly SimEventWire[]) {
      for (const fn of serverEventListeners) fn(events);
    },
    emitRenderEvents(events: readonly SimEventWire[]) {
      for (const fn of renderEventListeners) fn(events);
    },
  };
}

describe('W07-29 dev fauna hive and raid controls', () => {
  it('spawnHive (and alias fauna.hive) spawns a 3x3 species hive with initial residents in passive or aggressive mode', async () => {
    const { host, run } = makeLocalHarness();

    const outPassive = await run('spawnHive blueBeetle 10 -4 passive');
    expect(outPassive).toContain('dev.spawnhive ok');

    const fauna1 = getFaunaHivesState(host.state);
    const hives1 = Object.values(fauna1.hivesById);
    expect(hives1).toHaveLength(1);
    const beetleHive = hives1[0]!;
    expect(beetleHive.species).toBe('blueBeetle');
    expect(beetleHive.q).toBe(10);
    expect(beetleHive.r).toBe(-4);
    expect(beetleHive.mode).toBe('passive');
    expect(beetleHive.residentIds.length).toBeGreaterThan(0);

    const hRow = rowOf(host.state.entities, beetleHive.hiveId);
    expect(hRow).toBeGreaterThanOrEqual(0);
    expect(host.state.entities.cols.footprintW[hRow]).toBe(3);
    expect(host.state.entities.cols.footprintD[hRow]).toBe(3);

    const outAgg = await run('fauna.hive greenSpitter -8 6 aggressive');
    expect(outAgg).toContain('dev.spawnhive ok');

    const fauna2 = getFaunaHivesState(host.state);
    const spitterHive = Object.values(fauna2.hivesById).find((h) => h.species === 'greenSpitter');
    expect(spitterHive).toBeDefined();
    expect(spitterHive?.mode).toBe('aggressive');
    expect(spitterHive?.aggressiveColonies).toContain(0);
  });

  it('spawnRaid spawns/provokes a hive and always dispatches a bounded raid cohort even across repeated calls', async () => {
    const { host, run } = makeLocalHarness();

    const firstOut = await run('spawnRaid blackAnt 11 0');
    expect(firstOut).toContain('dev.spawnraid ok');

    const faunaAfterFirst = getFaunaHivesState(host.state);
    const hives = Object.values(faunaAfterFirst.hivesById);
    expect(hives.length).toBeGreaterThanOrEqual(1);
    const antHive = hives[0]!;
    expect(antHive.mode).toBe('aggressive');
    const firstCohortId = antHive.aggressionByColony[0]?.activeCohortId;
    expect(firstCohortId).toBeTruthy();
    const firstCohort = faunaAfterFirst.cohortsById[firstCohortId!];
    expect(firstCohort?.memberIds.length).toBeGreaterThan(0);

    for (const bugId of firstCohort?.memberIds ?? []) {
      const r = rowOf(host.state.entities, bugId);
      if (r >= 0) applyDamage(host.state, bugId, 9999, { attackerOwner: 0, tick: host.tick });
    }

    const secondOut = await run('spawnRaid 5');
    expect(secondOut).toContain('dev.spawnraid ok');
    const faunaAfterSecond = getFaunaHivesState(host.state);
    const secondCohortId = faunaAfterSecond.hivesById[antHive.hiveId]?.aggressionByColony[0]?.activeCohortId;
    expect(secondCohortId).toBeTruthy();
    expect(faunaAfterSecond.cohortsById[secondCohortId!]?.memberIds.length).toBeGreaterThan(0);
  });

  it('faunaMode and faunaTarget switch passive/aggressive mode and retarget hives and individual bugs', async () => {
    const { host, run } = makeLocalHarness();

    await run('spawnHive blackAnt 9 -2 passive');
    const hive = Object.values(getFaunaHivesState(host.state).hivesById)[0]!;
    const bugId = hive.residentIds[0]!;
    const hqId = host.state.entities.cols.id[0]!;

    const outAgg = await run(`faunaMode ${hive.hiveId} aggressive`);
    expect(outAgg).toContain('dev.faunamode ok');
    expect(getFaunaHivesState(host.state).hivesById[hive.hiveId]?.mode).toBe('aggressive');

    const outTarget = await run(`faunaTarget ${hive.hiveId} ${hqId}`);
    expect(outTarget).toContain('dev.faunamode ok');
    const activeCohortId = getFaunaHivesState(host.state).hivesById[hive.hiveId]?.aggressionByColony[0]?.activeCohortId;
    expect(getFaunaHivesState(host.state).cohortsById[activeCohortId!]?.targetEntityId).toBe(hqId);

    const outPassive = await run(`fauna.mode ${hive.hiveId} passive`);
    expect(outPassive).toContain('dev.faunamode ok');
    expect(getFaunaHivesState(host.state).hivesById[hive.hiveId]?.mode).toBe('passive');

    const outBugTarget = await run(`fauna.target ${bugId} 4 -3`);
    expect(outBugTarget).toContain('dev.faunamode ok');
    const bugRow = rowOf(host.state.entities, bugId);
    expect(getFaunaHivesState(host.state).bugsById[bugId]?.mode).toBe('aggressive');
    expect(host.state.entities.cols.targetQ[bugRow]).toBe(4);
    expect(host.state.entities.cols.targetR[bugRow]).toBe(-3);
  });
});

describe('W07-29 dev unit and godMode controls', () => {
  it('spawnUnit spawns demoArtillery, demoTank, recon, and fauna bugs with expected HP, stance, and supply', async () => {
    const { host, run } = makeLocalHarness();

    expect(await run('spawnUnit demoArtillery 2 1')).toContain('dev.spawnunit ok');
    expect(await run('spawnUnit demoTank 3 1')).toContain('dev.spawnunit ok');
    expect(await run('spawnUnit recon 4 1 2')).toContain('dev.spawnunit ok');
    expect(await run('spawnunit blueBeetle 8 -2')).toContain('dev.spawnunit ok');

    const cols = host.state.entities.cols;
    let artilleryRow = -1;
    let tankRow = -1;
    let reconCount = 0;
    let beetleRow = -1;

    for (let r = 0; r < host.state.entities.count; r++) {
      if (cols.kind[r] === ENTITY_KIND.demoArtillery) artilleryRow = r;
      if (cols.kind[r] === ENTITY_KIND.demoTank) tankRow = r;
      if (cols.kind[r] === ENTITY_KIND.recon) reconCount++;
      if (cols.kind[r] === ENTITY_KIND.blueBeetle) beetleRow = r;
    }

    expect(artilleryRow).toBeGreaterThanOrEqual(0);
    expect(cols.hpMax[artilleryRow]).toBe(320);
    expect(cols.state[artilleryRow]).toBe(ENTITY_STATE.idle);
    expect(getUnitStance(host.state, cols.id[artilleryRow]!)).toBe('defend');

    expect(tankRow).toBeGreaterThanOrEqual(0);
    expect(cols.hpMax[tankRow]).toBe(520);
    expect(getUnitStance(host.state, cols.id[tankRow]!)).toBe('defend');

    expect(reconCount).toBe(2);
    expect(beetleRow).toBeGreaterThanOrEqual(0);
    expect(cols.owner[beetleRow]).toBe(-1);
    expect((host.state.colonies[0]?.supply as { used?: number } | undefined)?.used).toBeGreaterThan(0);
  });

  it('godMode toggles and sets colony invulnerability so applyDamage clamps own colony damage to 0', async () => {
    const { host, run } = makeLocalHarness();
    const hqId = host.state.entities.cols.id[0]!;
    const hqRow = rowOf(host.state.entities, hqId);
    const initialHp = host.state.entities.cols.hp[hqRow]!;

    expect(await run('godMode on')).toContain('dev.godmode ok');
    expect(isColonyGodMode(host.state, 0)).toBe(true);

    const resGod = applyDamage(host.state, hqId, 150, { attackerOwner: -1, tick: host.tick });
    expect(resGod.applied).toBe(0);
    expect(host.state.entities.cols.hp[hqRow]).toBe(initialHp);

    expect(await run('godMode off')).toContain('dev.godmode ok');
    expect(isColonyGodMode(host.state, 0)).toBe(false);

    const resNormal = applyDamage(host.state, hqId, 50, { attackerOwner: -1, tick: host.tick });
    expect(resNormal.applied).toBe(50);
    expect(host.state.entities.cols.hp[hqRow]).toBe(initialHp - 50);

    expect(await run('godMode')).toContain('dev.godmode ok');
    expect(isColonyGodMode(host.state, 0)).toBe(true);
  });
});

describe('W07-29 hitDebug 3D overlay', () => {
  it('hitDebug on / off toggles the 3D hit-debug-overlay group, DOM indicator, aim points, and AoE splash rings', async () => {
    const { host, scene, ctx, run } = makeLocalHarness();
    const renderer = createHitDebugRenderer(ctx);

    expect(await run('hitDebug on')).toBe('hitDebug on');
    expect(renderer.isEnabled()).toBe(true);
    expect(renderer.group.name).toBe('hit-debug-overlay');
    expect(renderer.group.visible).toBe(true);
    expect(scene.children).toContain(renderer.group);

    const domEl = document.querySelector('[data-testid="hit-debug-overlay"]') as HTMLElement | null;
    expect(domEl).not.toBeNull();
    expect(domEl?.getAttribute('data-enabled')).toBe('true');

    await run('spawnUnit demoArtillery 1 0');
    await run('spawnUnit blackAnt 5 0');

    let artilleryId = 0;
    let antId = 0;
    for (let r = 0; r < host.state.entities.count; r++) {
      if (host.state.entities.cols.kind[r] === ENTITY_KIND.demoArtillery) artilleryId = host.state.entities.cols.id[r]!;
      if (host.state.entities.cols.kind[r] === ENTITY_KIND.blackAnt) antId = host.state.entities.cols.id[r]!;
    }

    const pending = fireProjectile(host.state, {
      attackerId: artilleryId,
      attackerOwner: 0,
      targetId: antId,
      weaponId: 'artilleryShell',
      weaponKind: 'shell',
      from: { x: 1, y: 0, q: 1, r: 0 },
      to: { x: 5, y: 0, q: 5, r: 0 },
      damage: 90,
      speed: 4,
      aoe: 1.5,
      tick: host.tick,
    });
    host.sync(false);
    renderer.update(host.store.latest!, 0.016);

    expect(renderer.getAimPoints().length).toBeGreaterThanOrEqual(1);
    expect(renderer.getAimPoints()[0]).toMatchObject({
      q: 5,
      r: 0,
      aoe: 1.5,
      splashRadius: 1.5,
    });
    expect(renderer.getAimPoints()[0]!.radiusWorld).toBeCloseTo(1.5 * Math.sqrt(3), 5);

    stepProjectileImpacts(host.state, pending.impactTick);
    host.step(pending.impactTick - host.tick + 1);
    renderer.update(host.store.latest!, 0.016);

    expect(renderer.getHitCircles().length).toBeGreaterThanOrEqual(1);
    expect(renderer.getHitCircles()[0]!.radiusWorld).toBeCloseTo(1.5 * Math.sqrt(3), 5);
    expect(domEl?.getAttribute('data-aim-count')).not.toBe('0');
    expect(domEl?.getAttribute('data-aoe-count')).not.toBe('0');

    expect(await run('hitDebug off')).toBe('hitDebug off');
    expect(renderer.isEnabled()).toBe(false);
    expect(renderer.group.visible).toBe(false);
    expect(domEl?.getAttribute('data-enabled')).toBe('false');

    renderer.dispose();
  });
});
