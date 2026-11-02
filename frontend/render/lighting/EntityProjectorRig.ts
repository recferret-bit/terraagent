import * as THREE from 'three';

export interface EntityProjectorRigState {
  readonly group: THREE.Group;
  readonly beamMat: THREE.MeshBasicMaterial;
  readonly poolMat: THREE.MeshBasicMaterial;
  readonly lensMat: THREE.MeshBasicMaterial;
  readonly kind: 'robot' | 'building' | 'pod';
}

function buildVolumetricConeGeo(topRadius: number, bottomRadius: number, length: number): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(topRadius, bottomRadius, length, 16, 1, true);
  geo.translate(0, -length * 0.5, 0);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = Math.max(0, Math.min(1, -y / Math.max(0.01, length)));
    const fade = Math.pow(1 - t, 1.75) * (t < 0.06 ? 0.85 : 1.0);
    colors[i * 3] = fade;
    colors[i * 3 + 1] = fade;
    colors[i * 3 + 2] = fade;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function buildGroundPoolGeo(radius: number): THREE.BufferGeometry {
  const geo = new THREE.CircleGeometry(radius, 24);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.min(1, Math.hypot(x, z) / Math.max(0.01, radius));
    const fade = Math.pow(1 - r * r, 1.8);
    colors[i * 3] = fade;
    colors[i * 3 + 1] = fade;
    colors[i * 3 + 2] = fade;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function addRobotProjectorParts(
  group: THREE.Group,
  beamMat: THREE.MeshBasicMaterial,
  poolMat: THREE.MeshBasicMaterial,
  lensMat: THREE.MeshBasicMaterial,
): void {
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 6), lensMat);
  lens.position.set(0, 1.32, 0.24);
  lens.castShadow = false;

  const coneGeo = buildVolumetricConeGeo(0.06, 2.05, 7.6);
  const cone = new THREE.Mesh(coneGeo, beamMat);
  cone.name = 'projector-beam-cone';
  cone.position.set(0, 1.32, 0.24);
  cone.rotation.x = -Math.PI / 2 + 0.21;
  cone.castShadow = false;
  cone.renderOrder = 2;

  const forwardPool = new THREE.Mesh(buildGroundPoolGeo(2.6), poolMat);
  forwardPool.name = 'projector-ground-pool';
  forwardPool.position.set(0, 0.04, 4.3);
  forwardPool.scale.set(1.0, 1.0, 1.35);
  forwardPool.castShadow = false;
  forwardPool.renderOrder = 1;

  group.add(lens, cone, forwardPool);
}

function addBuildingProjectorParts(
  group: THREE.Group,
  archetypeId: string,
  beamMat: THREE.MeshBasicMaterial,
  poolMat: THREE.MeshBasicMaterial,
  lensMat: THREE.MeshBasicMaterial,
): void {
  const isHero = archetypeId === 'building.commandHub' || archetypeId === 'building.rocket' || archetypeId === 'building.roboticsFactory';
  const rx = isHero ? 2.05 : 1.05;
  const rz = isHero ? 1.95 : 1.05;
  const lampY = isHero ? 1.82 : 1.38;
  const coneLen = isHero ? 6.4 : 4.4;
  const coneRad = isHero ? 2.2 : 1.55;
  const reach = isHero ? 2.85 : 1.95;

  const lensGeo = new THREE.SphereGeometry(isHero ? 0.09 : 0.065, 8, 6);
  const coneGeo = buildVolumetricConeGeo(0.08, coneRad, coneLen);
  const spotPoolGeo = buildGroundPoolGeo(isHero ? 2.6 : 1.8);

  const corners: readonly [number, number][] = [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ];

  for (const [sx, sz] of corners) {
    const lx = sx * rx;
    const lz = sz * rz;
    const lens = new THREE.Mesh(lensGeo, lensMat);
    lens.position.set(lx, lampY, lz);
    lens.castShadow = false;

    const cone = new THREE.Mesh(coneGeo, beamMat);
    cone.name = 'projector-beam-cone';
    cone.position.set(lx, lampY, lz);
    const outYaw = Math.atan2(sx, sz);
    cone.rotation.order = 'YXZ';
    cone.rotation.y = outYaw;
    cone.rotation.x = -Math.PI / 2 + 0.58;
    cone.castShadow = false;
    cone.renderOrder = 2;

    const spotPool = new THREE.Mesh(spotPoolGeo, poolMat);
    spotPool.name = 'projector-ground-pool';
    spotPool.position.set(sx * (rx + reach), 0.04, sz * (rz + reach));
    spotPool.castShadow = false;
    spotPool.renderOrder = 1;

    group.add(lens, cone, spotPool);
  }

  const centerHalo = new THREE.Mesh(buildGroundPoolGeo(isHero ? 4.8 : 2.8), poolMat);
  centerHalo.position.set(0, 0.03, 0);
  centerHalo.castShadow = false;
  centerHalo.renderOrder = 1;
  group.add(centerHalo);
}

function addPodProjectorParts(
  group: THREE.Group,
  beamMat: THREE.MeshBasicMaterial,
  poolMat: THREE.MeshBasicMaterial,
  lensMat: THREE.MeshBasicMaterial,
): void {
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), lensMat);
  lens.position.set(0, 0.25, 0);
  lens.castShadow = false;

  const cone = new THREE.Mesh(buildVolumetricConeGeo(0.18, 2.6, 5.5), beamMat);
  cone.name = 'projector-beam-cone';
  cone.position.set(0, 0.35, 0);
  cone.castShadow = false;
  cone.renderOrder = 2;

  const pool = new THREE.Mesh(buildGroundPoolGeo(3.2), poolMat);
  pool.name = 'projector-ground-pool';
  pool.position.set(0, 0.04, 0);
  pool.castShadow = false;
  pool.renderOrder = 1;

  group.add(lens, cone, pool);
}

/**
 * Attaches a 3D volumetric projector rig (lamp lens, volumetric spotlight cones, and ground illumination discs)
 * to a robot, building, or drop-pod mesh. Idempotent if already attached.
 */
export function attachEntityProjectorRig(mesh: THREE.Object3D, archetypeId: string): EntityProjectorRigState | null {
  const existing = (mesh.userData as { projectorRig?: EntityProjectorRigState } | undefined)?.projectorRig;
  if (existing) return existing;

  const isRobot = archetypeId.startsWith('robot.');
  const isBuilding = archetypeId.startsWith('building.');
  const isPod = archetypeId === 'ship.dropPod';
  if (!isRobot && !isBuilding && !isPod) return null;

  const kind: EntityProjectorRigState['kind'] = isRobot ? 'robot' : isBuilding ? 'building' : 'pod';
  const beamColor = isRobot ? 0x7de8ff : 0xffdf9e;
  const lensColor = isRobot ? 0xb8f4ff : 0xfff0c8;

  const beamMat = new THREE.MeshBasicMaterial({
    color: beamColor,
    vertexColors: true,
    transparent: true,
    opacity: 0.14,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });

  const poolMat = new THREE.MeshBasicMaterial({
    color: beamColor,
    vertexColors: true,
    transparent: true,
    opacity: 0.12,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });

  const lensMat = new THREE.MeshBasicMaterial({
    color: lensColor,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });

  const group = new THREE.Group();
  group.name = 'entity-projector-rig';

  if (isRobot) {
    addRobotProjectorParts(group, beamMat, poolMat, lensMat);
  } else if (isBuilding) {
    addBuildingProjectorParts(group, archetypeId, beamMat, poolMat, lensMat);
  } else {
    addPodProjectorParts(group, beamMat, poolMat, lensMat);
  }

  mesh.add(group);
  const state: EntityProjectorRigState = { group, beamMat, poolMat, lensMat, kind };
  mesh.userData = { ...(mesh.userData ?? {}), projectorRig: state };
  return state;
}

/** Modulates a mesh's projector rig intensity according to `nightFactor` [0..2] and construction `buildStage` [0..1]. */
export function updateEntityProjectorRig(mesh: THREE.Object3D, nightFactor: number, buildStage = 1): void {
  const rig = (mesh.userData as { projectorRig?: EntityProjectorRigState } | undefined)?.projectorRig;
  if (!rig) return;
  const stageScale = rig.kind === 'building' ? (buildStage <= 0.01 ? 0.18 : 0.35 + 0.65 * buildStage) : 1.0;
  const nightBoost = Math.max(0, Math.min(2.0, nightFactor));
  const active = (0.10 + 0.90 * Math.min(1.4, nightBoost)) * stageScale;

  rig.beamMat.opacity = Math.min(0.62, 0.36 * active);
  rig.poolMat.opacity = Math.min(0.54, 0.30 * active);
  rig.lensMat.opacity = Math.min(1.0, 0.45 + 0.55 * active);
  rig.group.visible = active > 0.01;
}
