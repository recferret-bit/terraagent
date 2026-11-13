import * as THREE from 'three';
import type { ColonyViewport } from '@terra/render/core/createColonyViewport';
import {
  ArchetypeCatalog,
  createArchetypeMesh,
  setArchetypeBuildProgress,
  setArchetypeRuin,
  tickArchetypeMesh,
  type ArchetypeMesh,
} from '@terra/render/kitbash';
import {
  ParticlePresetRegistry,
  WorkParticleEmitter,
  type InteractionTargetKind,
} from '@terra/render/particles';
import { CombatBurstSystem } from '@terra/render/particles/CombatBurstSystem';
import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import { ProjectileVfxSystem } from '@terra/render/visuals/projectiles';
import { InstancedRangeRings } from '@terra/render/visuals/rings';
import { LightningStrikeFx, MeteorStrikeFx, TwisterFx } from '@terra/render/weather';
import type { ArchetypeActionMode, DepositStageMode, EntityCardSpec } from './data/entitiesCatalog';

export interface CardControlState {
  action: ArchetypeActionMode;
  stage: DepositStageMode;
}

export interface CardSlot {
  spec: EntityCardSpec;
  cardEl: HTMLElement;
  canvas: HTMLCanvasElement;
  state: CardControlState;
  renderedKey: string;
  needsRender: boolean;
}

export interface ActivePreviewRig {
  slot: CardSlot;
  key: string;
  group: THREE.Group;
  elapsed: number;
  dispose: () => void;
  step: (dt: number) => void;
}

export type RigHandle = Omit<ActivePreviewRig, 'slot' | 'key'>;

export function buildPedestal(radius: number): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(radius, radius * 1.04, 0.14, 6);
  const mat = new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 0.85, metalness: 0.25 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -0.07;
  mesh.receiveShadow = true;
  return mesh;
}

export function getArchetypeGeometryBox(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  if (root instanceof THREE.Mesh && root.geometry) {
    if (!root.geometry.boundingBox) root.geometry.computeBoundingBox();
    if (root.geometry.boundingBox) {
      return root.geometry.boundingBox.clone().applyMatrix4(root.matrixWorld);
    }
  }
  return new THREE.Box3().setFromObject(root);
}

export function frameCameraForBox(
  vp: ColonyViewport,
  box: THREE.Box3,
  angleOffset: number,
  minRadius = 0.58,
): void {
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);
  const sphereRadius = Math.max(minRadius, size.length() * 0.5);
  const halfFovV = THREE.MathUtils.degToRad(vp.camera.fov) * 0.5;
  const aspect = vp.camera.aspect > 0 ? vp.camera.aspect : 1.6;
  const halfFovH = Math.atan(Math.tan(halfFovV) * aspect);
  const sinHalf = Math.max(0.12, Math.sin(Math.min(halfFovV, halfFovH)));
  const fitDist = (sphereRadius * 1.04) / sinHalf;
  const az = 0.72 + angleOffset;
  const horizDist = fitDist * 0.84;
  vp.camera.position.set(
    center.x + Math.cos(az) * horizDist,
    center.y + fitDist * 0.54,
    center.z + Math.sin(az) * horizDist,
  );
  vp.camera.lookAt(center);
  vp.camera.updateProjectionMatrix();
  vp.followShadow(center);
}

export function disposeGroupGeometries(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.geometry.dispose();
  });
}

function buildTerrainTargetProp(kind: InteractionTargetKind, biome: PlanetKind): THREE.Object3D | null {
  if (kind === 'tree') {
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.16, 0.75, 6),
      new THREE.MeshStandardMaterial({ color: 0x5d432c, roughness: 0.9 }),
    );
    trunk.position.y = 0.37;
    const crown = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.42, 0),
      new THREE.MeshStandardMaterial({
        color: biome === 'dune' ? 0x6b8f48 : 0x2f8f5b,
        roughness: 0.8,
      }),
    );
    crown.position.y = 0.9;
    tree.add(trunk, crown);
    return tree;
  }
  if (kind === 'rock') {
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.45, 0),
      new THREE.MeshStandardMaterial({ color: 0x636b78, roughness: 0.9, flatShading: true }),
    );
    rock.scale.set(1.15, 0.78, 0.95);
    rock.position.y = 0.28;
    return rock;
  }
  if (kind === 'dune') {
    const mound = new THREE.Mesh(
      new THREE.ConeGeometry(0.62, 0.42, 7),
      new THREE.MeshStandardMaterial({ color: 0xc28e4c, roughness: 0.95, flatShading: true }),
    );
    mound.position.y = 0.21;
    return mound;
  }
  if (kind === 'hole') {
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.11, 6, 8),
      new THREE.MeshStandardMaterial({ color: 0x4b5362, roughness: 0.92, flatShading: true }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.06;
    return rim;
  }
  if (kind === 'flat') {
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.6, 0.12, 6),
      new THREE.MeshStandardMaterial({ color: 0x456b52, roughness: 0.85, flatShading: true }),
    );
    pad.position.y = 0.06;
    return pad;
  }
  return null;
}

export function createArchetypeRig(
  slot: CardSlot,
  biome: PlanetKind,
  vp: ColonyViewport,
): RigHandle {
  const group = new THREE.Group();
  const mode = slot.spec.shaderMode ?? slot.state.action;
  const stage = slot.spec.stages ? slot.state.stage : 'full';
  const entry = ArchetypeCatalog.get(slot.spec.targetId);
  const fp = entry?.footprint ?? [1, 1];
  const mesh: ArchetypeMesh = createArchetypeMesh(slot.spec.targetId, biome, stage);
  group.add(mesh);

  const meshBox = getArchetypeGeometryBox(mesh);
  const meshSize = new THREE.Vector3();
  meshBox.getSize(meshSize);
  const pedRadius = Math.max(0.68, Math.max(fp[0] * 0.52, fp[1] * 0.52, meshSize.x * 0.56, meshSize.z * 0.56));
  group.add(buildPedestal(pedRadius));

  if (mode === 'build33') setArchetypeBuildProgress(mesh, 0.36);
  if (mode === 'ruin') setArchetypeRuin(mesh, true);

  vp.scene.add(group);
  frameCameraForBox(vp, meshBox, 0, 0.52);

  let t = 0;
  return {
    group,
    elapsed: 0,
    step: (dt) => {
      t += dt;
      tickArchetypeMesh(mesh, t, mode === 'walk' ? 1 : 0, mode === 'work' ? 1 : 0);
      frameCameraForBox(vp, meshBox, t * 0.35, 0.52);
    },
    dispose: () => {
      vp.scene.remove(group);
      disposeGroupGeometries(group);
    },
  };
}

export function createWorkFxRig(
  slot: CardSlot,
  biome: PlanetKind,
  vp: ColonyViewport,
): RigHandle {
  const group = new THREE.Group();
  group.add(buildPedestal(2.15));
  const kind = slot.spec.targetId.replace('work.', '') as InteractionTargetKind;
  const preset = ParticlePresetRegistry.get(slot.spec.targetId);
  const isBuilder = kind === 'repair' || kind === 'flat' || kind === 'hole' || kind === 'dune';
  const bot = createArchetypeMesh(isBuilder ? 'robot.builder' : 'robot.miner', biome, 'full');
  bot.position.set(-1.1, 0, 0.25);
  bot.rotation.y = Math.PI * 0.45;
  group.add(bot);

  let targetObj: THREE.Object3D;
  const terrainProp = buildTerrainTargetProp(kind, biome);
  if (terrainProp) {
    terrainProp.position.set(0.95, terrainProp.position.y, -0.1);
    group.add(terrainProp);
    targetObj = terrainProp;
  } else {
    const targetId =
      kind === 'metals' ? 'resource.metalDeposit'
        : kind === 'minerals' ? 'resource.crystalDeposit'
          : kind === 'oil' ? 'resource.oilDeposit'
            : 'building.pylon';
    const target = createArchetypeMesh(targetId, biome, 'full');
    if (kind === 'repair') setArchetypeRuin(target, true);
    target.position.set(0.95, 0, -0.1);
    target.scale.setScalar(0.85);
    group.add(target);
    targetObj = target;
  }

  let emitter: WorkParticleEmitter | null = null;
  if (preset && preset.targetKind !== 'combat') {
    emitter = new WorkParticleEmitter(preset, {
      workerId: `wp-${slot.spec.id}`,
      targetKind: kind,
      botOrigin: [-0.82, 0.72, 0.25],
      toolOrigins: [[-0.6, 0.78, 0.1], [-0.6, 0.74, 0.38]],
      targetPos: [0.95, 0.42, -0.1],
      groundY: 0,
      intensity: 1,
    });
    group.add(emitter.group);
  }
  vp.scene.add(group);
  const box = new THREE.Box3(new THREE.Vector3(-1.8, 0, -1.2), new THREE.Vector3(1.8, 1.8, 1.2))
    .union(getArchetypeGeometryBox(bot))
    .union(getArchetypeGeometryBox(targetObj));
  box.max.y += 0.25;
  for (let i = 0; i < 16; i++) emitter?.step(0.033);
  frameCameraForBox(vp, box, 0.15);

  let t = 0;
  return {
    group,
    elapsed: 0,
    step: (dt) => {
      t += dt;
      tickArchetypeMesh(bot, t, 0, 1);
      emitter?.step(dt);
      frameCameraForBox(vp, box, t * 0.22 + 0.15);
    },
    dispose: () => {
      emitter?.dispose();
      vp.scene.remove(group);
      disposeGroupGeometries(group);
    },
  };
}

export function createCombatFxRig(slot: CardSlot, vp: ColonyViewport): RigHandle {
  const group = new THREE.Group();
  group.add(buildPedestal(1.4));
  const isMuzzle = slot.spec.targetId === 'combat.muzzle';
  const isLaserHit = slot.spec.targetId === 'combat.laserHit';

  if (isMuzzle) {
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.14, 0.85, 8),
      new THREE.MeshStandardMaterial({ color: 0x3b4455, metalness: 0.7, roughness: 0.35 }),
    );
    barrel.rotation.z = -Math.PI * 0.45;
    barrel.position.set(-0.46, 0.62, -0.05);
    group.add(barrel);
  }

  const bursts = new CombatBurstSystem(group);
  const tipPos = isMuzzle ? new THREE.Vector3(-0.02, 0.68, -0.05) : new THREE.Vector3(0, 0.76, 0);
  const origin = {
    at: tipPos,
    normal: new THREE.Vector3(0.88, 0.25, 0.15).normalize(),
    groundY: 0,
    scale: isMuzzle ? 2.8 : 1.25,
    ...(isMuzzle ? { source: () => ({ x: tipPos.x, y: tipPos.y, z: tipPos.z }) } : {}),
    direction: () => ({ x: 0.92, y: 0.18, z: 0.12 }),
  };
  vp.scene.add(group);
  bursts.emit(slot.spec.targetId, origin);
  if (isMuzzle) bursts.emit(slot.spec.targetId, origin);
  const preSteps = isMuzzle ? 1 : isLaserHit ? 3 : 5;
  const preDt = isMuzzle ? 0.008 : 0.02;
  for (let i = 0; i < preSteps; i++) bursts.update(preDt);
  const box = isMuzzle
    ? new THREE.Box3(new THREE.Vector3(-0.95, 0, -0.85), new THREE.Vector3(1.15, 1.3, 0.85))
    : new THREE.Box3(new THREE.Vector3(-1.35, 0, -1.35), new THREE.Vector3(1.35, 1.65, 1.35));
  frameCameraForBox(vp, box, 0.12);

  let t = 0;
  let cooldown = isMuzzle ? 0.22 : 0.42;
  return {
    group,
    elapsed: 0,
    step: (dt) => {
      t += dt;
      cooldown -= dt;
      if (cooldown <= 0) {
        bursts.emit(slot.spec.targetId, origin);
        cooldown = isMuzzle ? 0.3 : isLaserHit ? 0.46 : 0.68;
      }
      bursts.update(dt);
      frameCameraForBox(vp, box, t * 0.3 + 0.12);
    },
    dispose: () => {
      bursts.dispose();
      vp.scene.remove(group);
      disposeGroupGeometries(group);
    },
  };
}

export function createWeatherFxRig(slot: CardSlot, vp: ColonyViewport): RigHandle {
  const group = new THREE.Group();
  const fxRoot = new THREE.Group();
  group.add(buildPedestal(3.9), fxRoot);
  vp.scene.add(group);

  const kind = slot.spec.weatherKind ?? 'lightning';
  const sceneProxy = fxRoot as unknown as THREE.Scene;
  const lightning = kind === 'lightning' ? new LightningStrikeFx(sceneProxy) : null;
  const twister = kind === 'twister' ? new TwisterFx(sceneProxy) : null;
  const meteor = kind === 'meteor' ? new MeteorStrikeFx(sceneProxy) : null;

  if (lightning) {
    lightning.strikeFourHexes([{ q: 0, r: 0 }]);
    lightning.update(0.05);
  }
  if (twister) {
    twister.spawnTwister({ q: 0, r: 0, wx: 0, wz: 0, durationS: 99, previewVictims: true });
    for (let i = 0; i < 25; i++) twister.update(0.05);
  }
  if (meteor) {
    meteor.triggerStrike({ x: 0, y: 0, z: 0 });
    for (let i = 0; i < 45; i++) meteor.update(0.05);
  }
  const box = new THREE.Box3(new THREE.Vector3(-3.4, 0, -3.4), new THREE.Vector3(3.4, 4.4, 3.4));
  frameCameraForBox(vp, box, 0.25);

  let timer = 0;
  return {
    group,
    elapsed: 0,
    step: (dt) => {
      timer += dt;
      if (lightning) {
        if (timer > 1.1) { timer = 0; lightning.strikeFourHexes([{ q: 0, r: 0 }]); }
        lightning.update(dt);
      }
      if (twister) twister.update(dt);
      if (meteor) {
        if (timer > 2.6) { timer = 0; meteor.triggerStrike({ x: 0, y: 0, z: 0 }); }
        meteor.update(dt);
      }
      frameCameraForBox(vp, box, 0.25);
    },
    dispose: () => {
      lightning?.update(10);
      lightning?.dispose();
      twister?.dispose();
      meteor?.dispose();
      fxRoot.clear();
      vp.scene.remove(group);
      disposeGroupGeometries(group);
    },
  };
}

export function createProjectileFxRig(biome: PlanetKind, vp: ColonyViewport): RigHandle {
  const group = new THREE.Group();
  group.add(buildPedestal(2.9));
  const turret = createArchetypeMesh('building.turret', biome, 'full');
  turret.position.set(-1.7, 0, 0.5);
  turret.scale.setScalar(0.8);
  group.add(turret);

  const projectiles = new ProjectileVfxSystem(group);
  const fireSalvo = () => {
    projectiles.onProjectileFired({
      weaponKind: 'shell',
      arc: 'indirect',
      from: { x: -1.55, y: 1.0, z: 0.45 },
      to: { x: 1.7, y: 0.35, z: -0.5 },
      durationS: 0.9,
      aoe: 1.2,
    });
    projectiles.onProjectileFired({
      weaponKind: 'laser',
      from: { x: -1.45, y: 0.92, z: 0.1 },
      to: { x: 1.5, y: 0.48, z: -0.1 },
      durationS: 0.55,
    });
    projectiles.onProjectileFired({
      weaponKind: 'rocket',
      from: { x: -1.5, y: 0.95, z: 0.7 },
      to: { x: 1.65, y: 0.45, z: 0.25 },
      durationS: 0.85,
    });
  };

  fireSalvo();
  for (let i = 0; i < 8; i++) projectiles.update(0.035);
  vp.scene.add(group);
  const box = new THREE.Box3(new THREE.Vector3(-2.5, 0, -1.6), new THREE.Vector3(2.4, 2.3, 1.6));
  frameCameraForBox(vp, box, 0.18);

  let t = 0;
  let cooldown = 0.75;
  return {
    group,
    elapsed: 0,
    step: (dt) => {
      t += dt;
      cooldown -= dt;
      if (cooldown <= 0) {
        fireSalvo();
        cooldown = 0.95;
      }
      projectiles.update(dt);
      frameCameraForBox(vp, box, t * 0.2 + 0.18);
    },
    dispose: () => {
      projectiles.dispose();
      vp.scene.remove(group);
      disposeGroupGeometries(group);
    },
  };
}

export function createRingFxRig(biome: PlanetKind, vp: ColonyViewport): RigHandle {
  const group = new THREE.Group();
  const fxRoot = new THREE.Group();
  group.add(buildPedestal(3.6), fxRoot);
  const shield = createArchetypeMesh('building.claimBeacon', biome, 'full');
  shield.scale.setScalar(0.85);
  group.add(shield);

  const rings = new InstancedRangeRings(fxRoot as unknown as THREE.Scene, 8);
  rings.setRings([
    { kind: 'minRange', radiusTiles: 0.72, worldX: 0, worldZ: 0, groundY: 0 },
    { kind: 'weapon', radiusTiles: 1.25, worldX: 0, worldZ: 0, groundY: 0 },
    { kind: 'viewRange', radiusTiles: 1.65, worldX: 0, worldZ: 0, groundY: 0 },
  ]);

  vp.scene.add(group);
  const box = new THREE.Box3(new THREE.Vector3(-3.3, 0, -3.3), new THREE.Vector3(3.3, 1.8, 3.3));
  frameCameraForBox(vp, box, 0.35);

  let t = 0;
  return {
    group,
    elapsed: 0,
    step: (dt) => {
      t += dt;
      rings.tick(dt);
      tickArchetypeMesh(shield, t, 0, 1);
      frameCameraForBox(vp, box, t * 0.25 + 0.35);
    },
    dispose: () => {
      rings.dispose();
      fxRoot.clear();
      vp.scene.remove(group);
      disposeGroupGeometries(group);
    },
  };
}
