import * as THREE from 'three';
import { createColonyViewport, type ColonyViewport } from '@terra/render/core/createColonyViewport';
import { setDayNight, setDayNightExternalSync, setDayNightParams } from '@terra/render/core/dayNightConfig';
import { StageHost } from '@terra/render/core/StageHost';
import {
  createArchetypeMesh,
  setArchetypeBuildProgress,
  stripBuildingPlinth,
  tickArchetypeMesh,
} from '@terra/render/kitbash';
import { attachEntityProjectorRig, resetColonyVisionAndLights } from '@terra/render/lighting';
import { GridCableRenderer } from '@terra/render/lighting/gridCables';
import {
  computeMeshToolOrigins,
  WorkParticleSystem,
  type ActiveWorkSiteInput,
  type InteractionTargetKind,
} from '@terra/render/particles';
import { applyPlanetLook } from '@terra/render/planets/applyPlanetLook';
import {
  createHexTerrain,
  specForPlanetType,
  tileXZ,
  type HexTerrain,
} from '@terra/render/planets/hex';
import {
  buildColonyHexTiles,
  buildColonyPowerSpans,
  COLONY_HEX_RADIUS,
  footprintGroundY,
  type ColonyGridNode,
} from './colonyHexScene';

interface HexBotAgent {
  id: string;
  archetypeId: string;
  mesh: THREE.Object3D;
  q: number;
  r: number;
  targetQ: number;
  targetR: number;
  targetKind: InteractionTargetKind;
  targetOffsetY: number;
  phaseS: number;
}

function stepHexBot(
  bot: HexBotAgent,
  terrain: HexTerrain,
  time: number,
  activeSites: ActiveWorkSiteInput[],
): void {
  const [bx, bz] = tileXZ(bot.q, bot.r);
  const by = terrain.heightAt(bx, bz);
  bot.mesh.position.set(bx, by, bz);

  const [tx, tz] = tileXZ(bot.targetQ, bot.targetR);
  const dx = tx - bx;
  const dz = tz - bz;
  bot.mesh.rotation.y = Math.atan2(dx, dz);

  const animTime = time + bot.phaseS;
  tickArchetypeMesh(bot.mesh, animTime, 0, 1);

  const groundY = terrain.heightAt(tx, tz);
  const pullX = tx - (dx / (Math.hypot(dx, dz) || 1)) * 0.1;
  const pullZ = tz - (dz / (Math.hypot(dx, dz) || 1)) * 0.1;
  const toolOrigins = computeMeshToolOrigins(bot.mesh, bot.archetypeId, 0, 1);
  activeSites.push({
    workerId: bot.id,
    targetKind: bot.targetKind,
    botOrigin: [bx, by, bz],
    toolOrigins,
    targetPos: [pullX, groundY + bot.targetOffsetY, pullZ],
    groundY,
    intensity: 1,
  });
}

/**
 * Exact in-game hex gameplay renderer for Section 02 (`02 · A COLONY, RUNNING`):
 * - Uses `createHexTerrain` on the `ocean` (`oceanForest`) planet spec with a clear pod-arrival radius around the base
 * - Places HQ (`building.commandHub`), Solar Array (`building.solar`), Pylon (`building.pylon`), and Metal Extractor (`building.mine`)
 *   with clean gaps between buildings and a clear gap from the shoreline water
 * - Drives 3 stationary harvesters (`robot.miner`) — 1 terraforming rocks and 2 terraforming trees — with `WorkParticleSystem` tool beams and bouncing 3D debris chunks
 * - Uses the exact `RTSCamera` angle (`fov = 28°`, `elev = 42°`, `yaw = 45°`) and `vp.followShadow(target)` with zero user input
 */
export class ColonyStage3D {
  readonly vp: ColonyViewport;
  readonly terrain: HexTerrain;
  private readonly entityGroup = new THREE.Group();
  private readonly gridCables: GridCableRenderer;
  private readonly workParticles: WorkParticleSystem;
  private readonly buildings: THREE.Object3D[] = [];
  private readonly bots: HexBotAgent[] = [];
  private readonly lookTarget = new THREE.Vector3();
  private simTime = 0;

  constructor(private readonly host: HTMLElement) {
    host.querySelector('#colony-canvas')?.remove();
    resetColonyVisionAndLights();
    setDayNightExternalSync(true);
    setDayNight(true);
    setDayNightParams({ timeOfDay: 10.5, timeScale: 0 }, 'sync');

    this.vp = createColonyViewport(host);
    const look = specForPlanetType('ocean');
    applyPlanetLook(this.vp, look);

    const tiles = buildColonyHexTiles(COLONY_HEX_RADIUS);
    this.terrain = createHexTerrain({
      radius: COLONY_HEX_RADIUS,
      tiles,
      look,
      colorBlindMode: false,
    });
    this.vp.scene.add(this.terrain.group);

    this.entityGroup.name = 'landing-colony-entities';
    this.vp.scene.add(this.entityGroup);
    this.gridCables = new GridCableRenderer(this.vp.scene);
    this.workParticles = new WorkParticleSystem(this.vp.scene);

    this.populateColony(look.biomeKey);
    this.applyGameplayCameraPose();
    host.classList.add('is-live');
  }

  private placeConstructibleBuilding(
    id: number,
    archetypeId: string,
    biomeKey: string,
    q: number,
    r: number,
    footprint: '1x1' | '2x2' | '3x3',
    yaw = Math.PI / 2,
  ): ColonyGridNode {
    const mesh = createArchetypeMesh(archetypeId, biomeKey);
    stripBuildingPlinth(mesh);
    attachEntityProjectorRig(mesh, archetypeId);
    setArchetypeBuildProgress(mesh, 1);

    const [wx, wz] = footprint === '2x2' ? tileXZ(q + 0.5, r + 0.5) : tileXZ(q, r);
    const wy = footprintGroundY(this.terrain, q, r, footprint);
    mesh.position.set(wx, wy, wz);
    mesh.rotation.y = yaw;
    this.entityGroup.add(mesh);
    this.buildings.push(mesh);

    return {
      id,
      archetypeId,
      isPylon: archetypeId === 'building.pylon',
      mesh,
    };
  }

  private populateColony(biomeKey: string): void {
    // 1. HQ building (Command Hub, 3x3) at (0, 0) -> occupies q in [-1..1], r in [-1..1]
    const hq = this.placeConstructibleBuilding(1, 'building.commandHub', biomeKey, 0, 0, '3x3', Math.PI / 2);
    // 2. Pylon (1x1) at (0, -3) -> 2-hex gap north of HQ
    const pylon = this.placeConstructibleBuilding(2, 'building.pylon', biomeKey, 0, -3, '1x1', Math.PI / 2);
    // 3. Solar Panel (2x2) at (-4, -1) -> occupies q in [-4..-3], r in [-1..0] (2-hex gap west of HQ)
    const solar = this.placeConstructibleBuilding(3, 'building.solar', biomeKey, -4, -1, '2x2', Math.PI / 2);
    // 4. Metal Extractor (2x2) at (5, -2) -> occupies q in [5..6], r in [-2..-1] (wide 4-hex gap to the right of HQ)
    const mine = this.placeConstructibleBuilding(4, 'building.mine', biomeKey, 5, -2, '2x2', Math.PI / 2);

    const spans = buildColonyPowerSpans({ hq, pylon, solar, mine });
    this.gridCables.setSpans(spans, (x, z) => this.terrain.heightAt(x, z));

    // 5. Three stationary harvesters: 1 terraforming rocks, 2 terraforming trees (none touching metals).
    const assignments: ReadonlyArray<Omit<HexBotAgent, 'archetypeId' | 'mesh'>> = [
      { id: 'harvester-rock-1', q: 3, r: -4, targetQ: 3, targetR: -5, targetKind: 'rock', targetOffsetY: 0.42, phaseS: 0.2 },
      { id: 'harvester-tree-1', q: -2, r: 4, targetQ: -3, targetR: 5, targetKind: 'tree', targetOffsetY: 0.52, phaseS: 1.4 },
      { id: 'harvester-tree-2', q: -5, r: 2, targetQ: -6, targetR: 2, targetKind: 'tree', targetOffsetY: 0.52, phaseS: 2.6 },
    ];

    for (const spec of assignments) {
      const mesh = createArchetypeMesh('robot.miner', biomeKey);
      attachEntityProjectorRig(mesh, 'robot.miner');
      this.entityGroup.add(mesh);
      this.bots.push({
        ...spec,
        archetypeId: 'robot.miner',
        mesh,
      });
    }
  }

  /** Applies the exact `RTSCamera` angle (`fov = 28°`, `elev = 42°`, `yaw = 45°`) and shadow-frustum tracking. */
  private applyGameplayCameraPose(): void {
    const [tx, tz] = tileXZ(1.0, -0.3);
    const ty = this.terrain.heightAt(tx, tz);
    this.lookTarget.set(tx, ty, tz);

    const elev = THREE.MathUtils.degToRad(42);
    const yaw = Math.PI / 4;
    const dist = 42;
    const h = Math.sin(elev) * dist;
    const r = Math.cos(elev) * dist;

    this.vp.camera.fov = 28;
    this.vp.camera.updateProjectionMatrix();
    this.vp.camera.position.set(
      tx + Math.sin(yaw) * r,
      ty + h,
      tz + Math.cos(yaw) * r,
    );
    this.vp.camera.lookAt(this.lookTarget);
    this.vp.followShadow(this.lookTarget);
  }

  get tickCount(): number {
    return Math.floor(this.simTime * 10);
  }

  step(dt: number): void {
    const safeDt = Math.min(Math.max(dt, 0), 0.05);
    this.simTime += safeDt;

    this.terrain.tick(safeDt);
    for (const b of this.buildings) {
      tickArchetypeMesh(b, this.simTime, 0, 1);
    }

    const activeSites: ActiveWorkSiteInput[] = [];
    for (const bot of this.bots) {
      stepHexBot(bot, this.terrain, this.simTime, activeSites);
    }

    this.workParticles.syncSites(activeSites);
    this.workParticles.update(safeDt);
    this.gridCables.update(safeDt);
    this.vp.followShadow(this.lookTarget);
    this.vp.render();
  }

  start(onTick?: (stage: ColonyStage3D) => void): StageHost {
    const loop = new StageHost({
      elements: [this.host],
      onFrame: (dt) => {
        this.step(dt);
        onTick?.(this);
      },
      onResize: () => {
        this.vp.resize();
        this.applyGameplayCameraPose();
      },
    });
    loop.start();
    if (loop.reduced) {
      this.step(0.016);
      onTick?.(this);
    }
    return loop;
  }

  dispose(): void {
    setDayNightExternalSync(false);
    this.workParticles.dispose();
    this.gridCables.dispose();
    this.terrain.dispose();
    this.vp.dispose();
  }
}
