import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  classifySuspensionArchetype,
  createSuspensionState,
  stepUnitTerrainSuspension,
  SUSPENSION_PROFILES,
  type TerrainHeightSampler,
} from '../terrainSuspension';

function flatTerrain(y = 1.25): TerrainHeightSampler {
  return { heightAt: () => y };
}

describe('Visual 3D terrain suspension & chassis physics simulation', () => {
  it('classifies mobile archetypes into 5 suspension profiles, excludes hives/buildings, and keeps flat ground exact at 0 tilt', () => {
    expect(classifySuspensionArchetype('robot.tank')).toBe('spiderWalker');
    expect(classifySuspensionArchetype('robot.artillery')).toBe('spiderWalker');
    expect(classifySuspensionArchetype('robot.miner')).toBe('heavyTracked');
    expect(classifySuspensionArchetype('robot.recon')).toBe('lightRover');
    expect(classifySuspensionArchetype('robot.hero')).toBe('bipedWalker');
    expect(classifySuspensionArchetype('fauna.blackAnt')).toBe('multiLegged');
    expect(classifySuspensionArchetype('fauna.hive.blackAnt')).toBeNull();
    expect(classifySuspensionArchetype('building.solar')).toBeNull();
    expect(classifySuspensionArchetype('ship.dropPod')).toBeNull();

    for (const arch of ['robot.tank', 'robot.miner', 'robot.recon', 'robot.hero', 'fauna.blueBeetle']) {
      const state = createSuspensionState();
      let out = stepUnitTerrainSuspension({
        state,
        terrain: flatTerrain(1.25),
        archetypeId: arch,
        wx: 0,
        wz: 0,
        yaw: 0.4,
        fallbackY: 0,
        dt: 0,
      });
      for (let i = 0; i < 30; i++) {
        out = stepUnitTerrainSuspension({
          state,
          terrain: flatTerrain(1.25),
          archetypeId: arch,
          wx: i * 0.05,
          wz: i * 0.05,
          yaw: 0.4,
          fallbackY: 0,
          dt: 1 / 60,
        });
      }
      // Settle at rest
      for (let i = 0; i < 40; i++) {
        out = stepUnitTerrainSuspension({
          state,
          terrain: flatTerrain(1.25),
          archetypeId: arch,
          wx: 1.5,
          wz: 1.5,
          yaw: 0.4,
          fallbackY: 0,
          dt: 1 / 60,
        });
      }
      expect(out.y).toBeCloseTo(1.25, 4);
      expect(out.pitch).toBe(0);
      expect(out.roll).toBe(0);
    }
  });
});

describe('Visual 3D terrain suspension — uphill, downhill, and side-slope attitude', () => {
  it('pitches nose up when climbing uphill, nose down when descending, and rolls across side-slopes', () => {
    // Terrain rises along +Z (0.30 m per m)
    const slopeZ: TerrainHeightSampler = { heightAt: (_x, z) => 0.3 * z };

    const climbState = createSuspensionState();
    let climbOut = stepUnitTerrainSuspension({
      state: climbState, terrain: slopeZ, archetypeId: 'robot.tank', wx: 0, wz: 0, yaw: 0, fallbackY: 0, dt: 0,
    });
    for (let i = 1; i <= 30; i++) {
      climbOut = stepUnitTerrainSuspension({
        state: climbState, terrain: slopeZ, archetypeId: 'robot.tank', wx: 0, wz: i * 0.06, yaw: 0, fallbackY: 0, dt: 1 / 60,
      });
    }
    // In YXZ Euler with +Z forward (yaw = 0), negative X rotation lifts the +Z nose upward
    expect(climbOut.pitch).toBeLessThan(-0.18);
    expect(Math.abs(climbOut.roll)).toBeLessThan(1e-3);
    expect(climbOut.animTime).toBeGreaterThan(30 * (1 / 60));

    // Verify 3D +Z forward vector actually points upward (+Y > 0) under YXZ Euler
    const fwdWorld = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(climbOut.pitch, 0, climbOut.roll, 'YXZ'));
    expect(fwdWorld.y).toBeGreaterThan(0.18);

    // Facing -Z (yaw = PI) descending downslope -> positive X rotation pitches nose downward
    const descendState = createSuspensionState();
    let descendOut = stepUnitTerrainSuspension({
      state: descendState, terrain: slopeZ, archetypeId: 'robot.tank', wx: 0, wz: 4, yaw: Math.PI, fallbackY: 0, dt: 0,
    });
    for (let i = 1; i <= 30; i++) {
      descendOut = stepUnitTerrainSuspension({
        state: descendState, terrain: slopeZ, archetypeId: 'robot.tank', wx: 0, wz: 4 - i * 0.06, yaw: Math.PI, fallbackY: 0, dt: 1 / 60,
      });
    }
    expect(descendOut.pitch).toBeGreaterThan(0.18);
    const downFwd = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(descendOut.pitch, Math.PI, descendOut.roll, 'YXZ'));
    expect(downFwd.y).toBeLessThan(-0.18);

    // Side-slope rising along +X while facing +Z -> positive Z roll lifts +X side
    const sideSlope: TerrainHeightSampler = { heightAt: (x) => 0.28 * x };
    const rollState = createSuspensionState();
    let rollOut = stepUnitTerrainSuspension({
      state: rollState, terrain: sideSlope, archetypeId: 'robot.recon', wx: 0, wz: 0, yaw: 0, fallbackY: 0, dt: 0,
    });
    for (let i = 1; i <= 25; i++) {
      rollOut = stepUnitTerrainSuspension({
        state: rollState, terrain: sideSlope, archetypeId: 'robot.recon', wx: 0, wz: i * 0.05, yaw: 0, fallbackY: 0, dt: 1 / 60,
      });
    }
    expect(rollOut.roll).toBeGreaterThan(0.16);
    expect(Math.abs(rollOut.pitch)).toBeLessThan(0.03);
  });
});

describe('Visual 3D terrain suspension — archetype differentiation & dune-crest guards', () => {
  it('differentiates biped torso leveling from heavy tracked chassis and simulates acceleration squat & turn banking', () => {
    const steepSlope: TerrainHeightSampler = { heightAt: (_x, z) => 0.32 * z };
    const tankState = createSuspensionState();
    const heroState = createSuspensionState();

    stepUnitTerrainSuspension({ state: tankState, terrain: steepSlope, archetypeId: 'robot.tank', wx: 0, wz: 0, yaw: 0, fallbackY: 0, dt: 0 });
    stepUnitTerrainSuspension({ state: heroState, terrain: steepSlope, archetypeId: 'robot.hero', wx: 0, wz: 0, yaw: 0, fallbackY: 0, dt: 0 });
    for (let i = 0; i < 30; i++) {
      stepUnitTerrainSuspension({ state: tankState, terrain: steepSlope, archetypeId: 'robot.tank', wx: 0, wz: 0, yaw: 0, fallbackY: 0, dt: 1 / 60 });
      stepUnitTerrainSuspension({ state: heroState, terrain: steepSlope, archetypeId: 'robot.hero', wx: 0, wz: 0, yaw: 0, fallbackY: 0, dt: 1 / 60 });
    }
    // Biped walker keeps torso significantly more upright than full-conforming tracked tank
    expect(Math.abs(heroState.pitch)).toBeLessThan(Math.abs(tankState.pitch) * 0.65);

    // Acceleration squat -> braking dive -> centripetal turn bank on flat ground
    const rover = createSuspensionState();
    const flat = flatTerrain(0);
    stepUnitTerrainSuspension({ state: rover, terrain: flat, archetypeId: 'robot.recon', wx: 0, wz: 0, yaw: 0, fallbackY: 0, dt: 0 });
    const accelStep = stepUnitTerrainSuspension({
      state: rover, terrain: flat, archetypeId: 'robot.recon', wx: 0, wz: 0.14, yaw: 0, fallbackY: 0, dt: 1 / 60,
    });
    expect(accelStep.pitch).toBeLessThan(0); // nose lifts slightly on hard launch

    // Hard brake back to 0 speed -> nose dives positive relative to launch squat
    let brakeStep = accelStep;
    for (let i = 0; i < 4; i++) {
      brakeStep = stepUnitTerrainSuspension({
        state: rover, terrain: flat, archetypeId: 'robot.recon', wx: 0, wz: 0.14, yaw: 0, fallbackY: 0, dt: 1 / 60,
      });
    }
    expect(brakeStep.pitch).toBeGreaterThan(accelStep.pitch);

    // Fast turn at speed banks into turn (non-zero roll)
    const turnStep = stepUnitTerrainSuspension({
      state: rover, terrain: flat, archetypeId: 'robot.recon', wx: 0.04, wz: 0.26, yaw: 0.12, fallbackY: 0, dt: 1 / 60,
    });
    expect(Math.abs(turnStep.roll)).toBeGreaterThan(1e-4);
  });

  it('prevents belly clipping on sharp dune crests and stays finite & bounded across frame spikes and teleports', () => {
    // Sharp convex dune peak: center = 2.0 m, surrounding points drop steeply
    const duneCrest: TerrainHeightSampler = {
      heightAt: (x, z) => Math.max(0, 2.0 - Math.hypot(x, z) * 1.1),
    };
    const state = createSuspensionState();
    stepUnitTerrainSuspension({ state, terrain: duneCrest, archetypeId: 'robot.miner', wx: 0, wz: -0.6, yaw: 0, fallbackY: 0, dt: 0 });
    const crestOut = stepUnitTerrainSuspension({
      state, terrain: duneCrest, archetypeId: 'robot.miner', wx: 0, wz: 0, yaw: 0, fallbackY: 0, dt: 0.5, // huge 500ms frame spike
    });
    expect(Number.isFinite(crestOut.y)).toBe(true);
    expect(Number.isFinite(crestOut.pitch)).toBe(true);
    expect(Number.isFinite(crestOut.roll)).toBe(true);
    expect(crestOut.y).toBeGreaterThanOrEqual(2.0 - SUSPENSION_PROFILES.heavyTracked.bellyClearanceM - 1e-4);
    expect(crestOut.y + 0.21).toBeGreaterThan(2.0); // robot.miner chassis bed bottom at Y=0.21m clears the 2.0m peak
    expect(Math.abs(crestOut.pitch)).toBeLessThanOrEqual(SUSPENSION_PROFILES.heavyTracked.maxTiltRad + 1e-5);

    // Spider walker straddles narrow crests with its wide ±0.90m foot span while protecting its raised 0.36m belly
    const spiderState = createSuspensionState();
    stepUnitTerrainSuspension({ state: spiderState, terrain: duneCrest, archetypeId: 'robot.tank', wx: 0, wz: -0.6, yaw: 0, fallbackY: 0, dt: 0 });
    const spiderCrest = stepUnitTerrainSuspension({
      state: spiderState, terrain: duneCrest, archetypeId: 'robot.tank', wx: 0, wz: 0, yaw: 0, fallbackY: 0, dt: 0.5,
    });
    expect(spiderCrest.y).toBeGreaterThanOrEqual(2.0 - SUSPENSION_PROFILES.spiderWalker.bellyClearanceM - 1e-4);

    // Rover cresting a step drop-off droops under gravity and compresses shock absorbers on landing, then settles to 0
    const stepDrop: TerrainHeightSampler = { heightAt: (_x, z) => (z < 1.0 ? 1.0 : 0.0) };
    const dropState = createSuspensionState();
    stepUnitTerrainSuspension({ state: dropState, terrain: stepDrop, archetypeId: 'robot.recon', wx: 0, wz: 0, yaw: 0, fallbackY: 0, dt: 0 });
    let minLandingY = Infinity;
    for (let i = 1; i <= 45; i++) {
      const s = stepUnitTerrainSuspension({
        state: dropState, terrain: stepDrop, archetypeId: 'robot.recon', wx: 0, wz: Math.min(2.2, i * 0.08), yaw: 0, fallbackY: 0, dt: 1 / 60,
      });
      if (i * 0.08 >= 1.6) minLandingY = Math.min(minLandingY, s.y);
    }
    expect(minLandingY).toBeLessThan(0.05);
    expect(minLandingY).toBeGreaterThanOrEqual(-SUSPENSION_PROFILES.lightRover.bellyClearanceM - 1e-4);

    // Teleport (> 4.5 m in one frame) snaps cleanly to destination ground height with zero velocity spike
    const teleOut = stepUnitTerrainSuspension({
      state, terrain: flatTerrain(3.5), archetypeId: 'robot.miner', wx: 20, wz: 20, yaw: 1.0, fallbackY: 0, dt: 1 / 60,
    });
    expect(teleOut.y).toBeCloseTo(3.5, 5);
    expect(state.vy).toBe(0);
    expect(teleOut.surgeOffsetM).toBe(0);
  });
});

describe('Visual 3D terrain suspension — spider foot contact, 6-wheel bogies, and valley G-out', () => {
  it('keeps spider walker feet grounded on moderate dune crests (no mid-air float) and compresses suspension in concave troughs', () => {
    // Moderate rounded dune crest: center = 1.00 m, spider feet (±0.90m, ±0.52m) sit at ~0.56 m (rise = 0.44 m < 0.51 m underbelly)
    const moderateDune: TerrainHeightSampler = {
      heightAt: (x, z) => 1.0 - 0.41 * (x * x + z * z),
    };
    const spider = createSuspensionState();
    const spiderRest = stepUnitTerrainSuspension({
      state: spider,
      terrain: moderateDune,
      archetypeId: 'robot.tank',
      wx: 0,
      wz: 0,
      yaw: 0,
      fallbackY: 0,
      dt: 0,
    });
    const footGroundY = moderateDune.heightAt(0.9, 0.52);
    // Spider feet at Y=0 must sit right at footGroundY (~0.56m), never lifted into mid-air by premature bellyFloor
    expect(spiderRest.y).toBeCloseTo(footGroundY, 3);
    // Underbelly at Y=0.51 still clears the 1.00m crest peak
    expect(spiderRest.y + 0.51).toBeGreaterThan(1.0);

    // Moderate rounded dune crest across ALL 5 profiles: wheels/tracks/feet/legs stay grounded (no premature belly lift)
    const gentleDune: TerrainHeightSampler = {
      heightAt: (x, z) => 1.0 - 0.32 * (x * x + z * z),
    };
    for (const [arch, bellyBottomY] of [
      ['robot.recon', 0.215],
      ['robot.miner', 0.21],
      ['robot.hero', 0.88],
      ['fauna.blueBeetle', 0.31],
    ] as const) {
      const cls = classifySuspensionArchetype(arch)!;
      const prof = SUSPENSION_PROFILES[cls];
      const st = createSuspensionState();
      const rest = stepUnitTerrainSuspension({
        state: st, terrain: gentleDune, archetypeId: arch, wx: 0, wz: 0, yaw: 0, fallbackY: 0, dt: 0,
      });
      const cornerGroundY = gentleDune.heightAt(prof.halfWidth, prof.halfLength);
      const midGroundY = gentleDune.heightAt(prof.halfWidth, 0);
      const expectedSupport = cornerGroundY + Math.max(0, midGroundY - cornerGroundY) * prof.midAxleWeight;
      expect(rest.y, `${arch} grounded on support without mid-air float`).toBeCloseTo(expectedSupport, 3);
      expect(rest.y + bellyBottomY, `${arch} belly clears dune peak`).toBeGreaterThan(1.0);
    }
  });
});

describe('Visual 3D terrain suspension — 6-wheel bogies and valley G-out compression', () => {
  it('supports 6-wheeled rovers over transverse ridges and compresses suspension in concave troughs', () => {
    // 6-wheeled rover on a transverse ridge (z=0 higher than front/rear ±0.48m) gets mid-axle wheel support
    const ridgeZ: TerrainHeightSampler = {
      heightAt: (_x, z) => Math.max(0, 0.5 - Math.abs(z) * 0.45),
    };
    const rover = createSuspensionState();
    const roverRidge = stepUnitTerrainSuspension({
      state: rover,
      terrain: ridgeZ,
      archetypeId: 'robot.recon',
      wx: 0,
      wz: 0,
      yaw: 0,
      fallbackY: 0,
      dt: 0,
    });
    const frontRearAvg = ridgeZ.heightAt(0.42, 0.48);
    expect(roverRidge.y).toBeGreaterThan(frontRearAvg + 0.04);

    // Concave valley / trough G-out: driving down into z=0 bowl and up compresses suspension below static support
    const valley: TerrainHeightSampler = {
      heightAt: (_x, z) => 0.38 * z * z,
    };
    const troughRover = createSuspensionState();
    stepUnitTerrainSuspension({
      state: troughRover,
      terrain: valley,
      archetypeId: 'robot.recon',
      wx: 0,
      wz: -1.4,
      yaw: 0,
      fallbackY: 0,
      dt: 0,
    });
    let maxSquatBelowStatic = 0;
    for (let i = 1; i <= 35; i++) {
      const wz = -1.4 + i * 0.08;
      const dynamicOut = stepUnitTerrainSuspension({
        state: troughRover,
        terrain: valley,
        archetypeId: 'robot.recon',
        wx: 0,
        wz,
        yaw: 0,
        fallbackY: 0,
        dt: 1 / 60,
      });
      const staticState = createSuspensionState();
      const staticOut = stepUnitTerrainSuspension({
        state: staticState,
        terrain: valley,
        archetypeId: 'robot.recon',
        wx: 0,
        wz,
        yaw: 0,
        fallbackY: 0,
        dt: 0,
      });
      maxSquatBelowStatic = Math.max(maxSquatBelowStatic, staticOut.y - dynamicOut.y);
    }
    expect(maxSquatBelowStatic).toBeGreaterThan(0.01);
  });
});
