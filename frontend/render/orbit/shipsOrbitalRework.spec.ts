// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { validateArchetype } from '../kitbash/validate';
import { BiomeMaterialRegistry } from '../visuals/UnifiedColonyMaterial';
import { GuildShipRig } from '../visuals/space/GuildShipRig';
import { acquireModel } from '../visuals/space/placeholders';
import { syncSpaceBiomeRim } from '../visuals/space/spaceLighting';
import { stepHold } from './deploy/DeployFlight';
import { planDeploy } from './deploy/DeployPlan';
import type { DeployHost } from './deploy/types';
import { FLAGSHIP_SIZE, FlagshipCarrier } from './stage/FlagshipCarrier';
import { driftCarrier } from './stage/idle';

describe('Space ships rework: vacuum weathering gate & orbital planet rim sync', () => {
  it('suppresses ground-up dust on spaceLit orbital ships, restores it on touchdown, and syncs biome rim tint', () => {
    const fitted = acquireModel(
      'ship.flagshipCarrier',
      'dune',
      { size: FLAGSHIP_SIZE, mode: 'max', force: true },
      { spaceLit: true },
    );
    const mat = (fitted.mesh as THREE.Mesh).material as THREE.Material;
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    mat.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
    expect(shader.uniforms.uWeatheringIntensity?.value).toBe(0);
    fitted.setSpaceLit(false);
    expect(shader.uniforms.uWeatheringIntensity?.value).toBeGreaterThan(0.5);
    fitted.setSpaceLit(true);
    expect(shader.uniforms.uWeatheringIntensity?.value).toBe(0);

    syncSpaceBiomeRim(fitted.mesh, 'oceanForest');
    const rim = (fitted.mesh as THREE.Mesh).userData.uniforms.uRimTint.value as THREE.Color;
    expect(rim.getHex()).toBe(BiomeMaterialRegistry.getBiome('oceanForest').rimTint);
    fitted.dispose();
  });
});

describe('Space ships rework: orbital attitude across desktop aspect ratios', () => {
  it('banks orbital ships toward the planet while keeping solar wings oblique to camera', () => {
    expect(FLAGSHIP_SIZE).toBeGreaterThan(10.5);
    const scene = new THREE.Scene();
    const flagship = new FlagshipCarrier(scene);
    flagship.setLeadPatron({ carrierName: 'ISS sovereign.near' });
    const flagshipRoot = scene.children[0]!;
    const carrier = acquireModel('ship.carrier', 'dune', { size: 6.0, mode: 'max', force: true }, { spaceLit: true });
    carrier.root.rotation.order = 'YXZ';

    const wideCam = new THREE.PerspectiveCamera(28, 16 / 9, 0.5, 4000);
    for (const [aspect, px] of [
      [16 / 9, 10.44],
      [4 / 3, 7.83],
      [16 / 9, 0],
      [32 / 9, 20.88],
    ] as const) {
      wideCam.aspect = aspect;
      wideCam.position.set(0, 1.4, 62);
      wideCam.lookAt(px * 0.35, 0.3, 0);
      wideCam.updateProjectionMatrix();
      wideCam.updateMatrixWorld();
      const planetPos = new THREE.Vector3(px, 0, 0);
      for (const t of [0, 7.5, 19.0, 42.0]) {
        flagship.update(t, planetPos, true, wideCam);
        flagshipRoot.updateMatrixWorld(true);
        const fQuat = flagshipRoot.getWorldQuaternion(new THREE.Quaternion());
        const fBelly = new THREE.Vector3(0, -1, 0).applyQuaternion(fQuat).normalize();
        const toPlanet = planetPos.clone().sub(flagshipRoot.position).normalize();
        const toCam = wideCam.position.clone().sub(flagshipRoot.position).normalize();
        expect(fBelly.dot(toPlanet)).toBeGreaterThan(0.92);
        expect(fBelly.dot(toCam)).toBeGreaterThan(0.5);
        for (const s of [-1, 1] as const) {
          const podVec = new THREE.Vector3(0, -1, 0)
            .applyEuler(new THREE.Euler(0.06, 0, 0.08 * s))
            .applyQuaternion(fQuat)
            .normalize();
          expect(podVec.dot(toPlanet)).toBeGreaterThan(0.9);
          expect(podVec.dot(toCam)).toBeGreaterThan(0.45);
          for (const zTilt of [0.26 * s, -0.22 * s]) {
            const wingNrm = new THREE.Vector3(0, -1, 0)
              .applyEuler(new THREE.Euler(0.18, 0, zTilt))
              .applyQuaternion(fQuat)
              .normalize();
            expect(Math.abs(wingNrm.dot(toCam))).toBeGreaterThan(0.32);
          }
        }

        driftCarrier(carrier, planetPos, t, wideCam);
        carrier.root.updateMatrixWorld(true);
        const cBelly = new THREE.Vector3(0, -1, 0)
          .applyQuaternion(carrier.root.getWorldQuaternion(new THREE.Quaternion()))
          .normalize();
        expect(cBelly.dot(planetPos.clone().sub(carrier.root.position).normalize())).toBeGreaterThan(0.55);
      }
    }

    flagship.dispose();
    carrier.dispose();
  });
});

describe('Space ships rework: mobile viewport bounds & label projection', () => {
  it('keeps Flagship unclipped and label centered on narrow mobile viewports', () => {
    const scene = new THREE.Scene();
    const flagship = new FlagshipCarrier(scene);
    flagship.setLeadPatron({ carrierName: 'ISS sovereign.near' });
    const flagshipRoot = scene.children[0]!;

    for (const [w, h] of [
      [375, 812],
      [430, 932],
      [768, 1024],
    ] as const) {
      const mobileCam = new THREE.PerspectiveCamera(28, w / h, 0.5, 4000);
      mobileCam.position.set(0, 1.4, 62);
      mobileCam.lookAt(0, 0.3, 0);
      mobileCam.updateProjectionMatrix();
      mobileCam.updateMatrixWorld();
      flagship.update(2.0, new THREE.Vector3(0, 0, 0), true, mobileCam);
      flagshipRoot.updateMatrixWorld(true);
      const mBelly = new THREE.Vector3(0, -1, 0)
        .applyQuaternion(flagshipRoot.getWorldQuaternion(new THREE.Quaternion()))
        .normalize();
      expect(mBelly.dot(new THREE.Vector3(0, 0, 0).sub(flagshipRoot.position).normalize())).toBeGreaterThan(0.92);
      expect(mBelly.dot(mobileCam.position.clone().sub(flagshipRoot.position).normalize())).toBeGreaterThan(0.55);
      const box = new THREE.Box3().setFromObject(flagshipRoot);
      for (const cx of [box.min.x, box.max.x]) {
        for (const cy of [box.min.y, box.max.y]) {
          for (const cz of [box.min.z, box.max.z]) {
            const ndc = new THREE.Vector3(cx, cy, cz).project(mobileCam);
            expect(Math.abs(ndc.x), `mobile ${w}x${h} flagship corner X`).toBeLessThan(0.96);
            expect(Math.abs(ndc.y), `mobile ${w}x${h} flagship corner Y`).toBeLessThan(0.96);
          }
        }
      }
      const mobileProj = flagship.project(mobileCam)!;
      expect(mobileProj.visible).toBe(true);
      expect(mobileProj.nx).toBeGreaterThanOrEqual(0.26);
      expect(mobileProj.nx).toBeLessThanOrEqual(0.74);
      expect(mobileProj.ny).toBeGreaterThanOrEqual(0.1);
    }

    flagship.dispose();
  });
});

describe('Space ships rework: deploy hold shot', () => {
  it('levels carrier onto drop-station attitude so holdCam views the open ventral drop bay unobstructed', () => {
    const scene = new THREE.Scene();
    const carrier = acquireModel('ship.carrier', 'dune', { size: 6.0, mode: 'max', force: true }, { spaceLit: true });
    carrier.root.rotation.order = 'YXZ';
    scene.add(carrier.root);
    const cam = new THREE.PerspectiveCamera(28, 16 / 9, 0.5, 4000);
    cam.position.set(0, 1.4, 62);
    driftCarrier(carrier, new THREE.Vector3(6.2, 0, 0), 3.0, cam);

    const globeGroup = new THREE.Group();
    globeGroup.position.set(6.2, 0, 0);
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1, 4, 4),
      new THREE.ShaderMaterial({ uniforms: { uShell: { value: 1.04 } } }),
    );
    const host = {
      scene,
      camera: cam,
      viewport: { renderer: { toneMappingExposure: 1 }, bloom: { strength: 0.45 } },
      sunDir: new THREE.Vector3(0.62, 0.3, 0.55).normalize(),
      sun: {
        sunLight: new THREE.DirectionalLight(0xffffff, 2.5),
        hemi: new THREE.HemisphereLight(0xffffff, 0x222222, 0.8),
        rim: new THREE.DirectionalLight(0xffffff, 0.5),
      },
      backdrop: { uniforms: { uSunDisc: { value: 1 }, uSunColor: { value: new THREE.Color(0xffffff) } } },
      carrier,
      globes: {
        settleForDeploy: () => {},
        current: {
          group: globeGroup,
          clouds: new THREE.Group(),
          spin: new THREE.Group(),
          atmosphere,
          shared: { uCloudNear: { value: new THREE.Vector2() } },
        },
      },
      lookNow: new THREE.Vector3(2.1, 0.3, 0),
    } as unknown as DeployHost;
    const handoff = {
      R: 4000,
      centre: new THREE.Vector3(0, -4006, 0),
      sunDir: new THREE.Vector3(0.5, 0.7, 0.5).normalize(),
      pod: new THREE.Vector3(-80, 600, 50),
      podQuat: new THREE.Quaternion(),
      cam: new THREE.Vector3(-110, 610, 80),
      camTarget: new THREE.Vector3(-80, 599, 50),
      carrierScale: carrier.root.scale.x,
      podYawLocal: -0.3,
      bayGlow: 3.2,
      fov: 28,
    } as any;
    const { deploy } = planDeploy(host, handoff, { biomeKey: 'dune' });
    stepHold(host, deploy, 2.2, 0.05);
    carrier.root.updateMatrixWorld(true);
    const launchBelly = new THREE.Vector3(0, -1, 0)
      .applyQuaternion(carrier.root.getWorldQuaternion(new THREE.Quaternion()))
      .normalize();
    expect(host.camera.position.clone().sub(deploy.cCtr).normalize().dot(launchBelly)).toBeGreaterThan(0.18);
    deploy.rig.dispose();
    carrier.dispose();
  });
});

describe('Space ships rework: GuildShipRig & strict 5-ship validator', () => {
  it('mounts GuildShipRig drop bay onto belly cargo collar without protruding below skids and validates all 5 ship models strictly', () => {
    const rig = new GuildShipRig('dune');
    const dropGroup = rig.root.getObjectByName('dropRig')!;
    expect(dropGroup.position.y).toBeGreaterThan(0.6);
    expect(dropGroup.position.y).toBeLessThan(1.1);
    dropGroup.updateMatrixWorld(true);
    const dropBox = new THREE.Box3().setFromObject(dropGroup);
    expect(dropBox.min.y).toBeGreaterThan(0.05);
    rig.place({ x: 4, y: 2, z: -3, altitudeM: 12, bobM: 0, flame: 0.9, time: 1.5, yaw: 0.25 });
    rig.dispose();

    for (const id of [
      'ship.carrier',
      'ship.guildTrader',
      'ship.flagshipCarrier',
      'ship.dropPod',
      'ship.dropPodShell',
    ]) {
      const report = validateArchetype(id);
      expect(report.errors, `${id} errors: ${report.issues.map((x) => x.message).join('; ')}`).toBe(0);
      expect(report.warnings, `${id} warnings: ${report.issues.map((x) => x.message).join('; ')}`).toBe(0);
      expect(report.triCount).toBeLessThan(3500);
    }
  });
});
