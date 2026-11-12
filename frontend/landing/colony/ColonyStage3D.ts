import * as THREE from 'three';
import { createColonyViewport, type ColonyViewport } from '@terra/render/core/createColonyViewport';
import { StageHost } from '@terra/render/core/StageHost';
import { PLANET_SPECS } from '@terra/render/planets/PlanetSpec';
import { applyPlanetLook, createPlanetSurface, type PlanetSurface } from '@terra/render/planets/surface';
import { createArchetypeMesh, tickArchetypeMesh } from '@terra/render/kitbash';
import {
  buildInstanced,
  createFoliageMaterial,
  makeBroadleafGeo,
  makePalmGeo,
  type Place,
} from '@terra/render/visuals/terrain/Scatter';

interface BotRoute {
  mesh: THREE.Object3D;
  waypoints: [number, number][];
  speed: number;
  pauseS: number;
  phase: number;
}

interface ShorelineSite {
  cx: number;
  cz: number;
  waterDirX: number;
  waterDirZ: number;
}

/** Finds a dry coastal terrace on `oceanForest` right next to open water so both colony and shoreline fill the frame. */
function findShorelineSite(surface: PlanetSurface): ShorelineSite {
  let best: ShorelineSite = { cx: -10, cz: 14, waterDirX: 0.7, waterDirZ: 0.7 };
  let bestScore = -Infinity;

  for (let x = -28; x <= 28; x += 2) {
    for (let z = -28; z <= 28; z += 2) {
      const r = Math.hypot(x, z);
      if (r < 11 || r > 26) continue;
      const h = surface.heightAt(x, z);
      if (h < -0.15 || h > 1.35) continue;

      let waterHits = 0;
      let wxSum = 0;
      let wzSum = 0;
      let flatPenalty = 0;
      for (let a = 0; a < 8; a++) {
        const ang = (a * Math.PI) / 4;
        const dx = Math.cos(ang);
        const dz = Math.sin(ang);
        const nearH = surface.heightAt(x + dx * 4.5, z + dz * 4.5);
        flatPenalty += Math.abs(nearH - h);
        const farH = surface.heightAt(x + dx * 10, z + dz * 10);
        if (farH < -1.02) {
          waterHits++;
          wxSum += dx;
          wzSum += dz;
        }
      }
      if (waterHits >= 2 && waterHits <= 5) {
        const score = waterHits * 4 - flatPenalty + (r >= 14 ? 3 : 0);
        if (score > bestScore) {
          const len = Math.hypot(wxSum, wzSum) || 1;
          bestScore = score;
          best = { cx: x, cz: z, waterDirX: wxSum / len, waterDirZ: wzSum / len };
        }
      }
    }
  }
  return best;
}

/** Places lush broadleaf and palm trees around the shoreline colony (outside building pads) so trees frame the water. */
function addShorelineTrees(
  surface: PlanetSurface,
  site: ShorelineSite,
  timeU: THREE.IUniform<number>,
): { group: THREE.Group; dispose: () => void } {
  const group = new THREE.Group();
  const broadleafOffsets: [number, number, number][] = [
    [-7.5, -5.2, 1.25], [-4.2, -6.8, 1.4], [1.2, -7.2, 1.15], [6.8, -5.8, 1.35],
    [8.2, -1.2, 1.2], [-8.4, 0.8, 1.3], [-6.5, 5.2, 1.1], [7.4, 4.0, 1.15],
  ];
  const palmOffsets: [number, number, number][] = [
    [-3.4, 5.6, 1.15], [2.8, 5.2, 1.25], [6.2, 2.6, 1.1], [-6.8, -2.2, 1.2], [4.4, -5.6, 1.2],
  ];

  const toPlaces = (offsets: [number, number, number][]): Place[] =>
    offsets
      .map(([dx, dz, s], i) => {
        const x = site.cx + dx;
        const z = site.cz + dz;
        const y = surface.heightAt(x, z);
        return { x, z, y, s, rot: i * 1.7, r: (i * 0.19) % 1 };
      })
      .filter((p) => p.y > -0.75);

  const la = new THREE.Color(surface.spec.palette.groundLow).multiplyScalar(1.05);
  const lb = new THREE.Color(surface.spec.palette.groundHigh).multiplyScalar(0.92);
  const bMat = createFoliageMaterial(timeU, 1.0);
  const pMat = createFoliageMaterial(timeU, 2.2, true);
  const bGeo = makeBroadleafGeo(la, lb, 4);
  const pGeo = makePalmGeo(new THREE.Color(0x4c9a3a));

  const bMesh = buildInstanced(bGeo, bMat, toPlaces(broadleafOffsets), { sx: [0.95, 1.4], sy: [1.0, 1.6], sink: 0.1, tilt: 0.07 });
  const pMesh = buildInstanced(pGeo, pMat, toPlaces(palmOffsets), { sx: [0.95, 1.3], sy: [1.0, 1.45], sink: 0.1, tilt: 0.12 });
  group.add(bMesh, pMesh);

  return {
    group,
    dispose: () => {
      bGeo.dispose(); pGeo.dispose(); bMat.dispose(); pMat.dispose();
      bMesh.dispose(); pMesh.dispose();
    },
  };
}

/** Builds sagging overhead power lines from the Pylon to HQ, Solar Panel, and Metal Extractor. */
function buildPowerLinks(
  from: THREE.Vector3,
  targets: THREE.Vector3[],
): { group: THREE.Group; dispose: () => void } {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1b222c,
    roughness: 0.5,
    metalness: 0.7,
    emissive: new THREE.Color(0x166888),
    emissiveIntensity: 0.55,
  });
  const geos: THREE.BufferGeometry[] = [];
  for (const to of targets) {
    const mid = from.clone().lerp(to, 0.5);
    mid.y -= 0.38;
    const curve = new THREE.CatmullRomCurve3([from, mid, to]);
    const geo = new THREE.TubeGeometry(curve, 14, 0.022, 6, false);
    geos.push(geo);
    group.add(new THREE.Mesh(geo, mat));
  }
  return {
    group,
    dispose: () => {
      geos.forEach((g) => g.dispose());
      mat.dispose();
    },
  };
}

/** Advances a bot along its waypoint loop on the terrain surface and drives its GPU walk/work shader weights. */
function stepBotRoute(bot: BotRoute, surface: PlanetSurface, time: number): void {
  const pts = bot.waypoints;
  const segs = pts.length;
  const segDist = 4.6;
  const moveS = segDist / bot.speed;
  const legS = moveS + bot.pauseS;
  const totalS = legS * segs;
  const localT = (time + bot.phase) % totalS;
  const segIdx = Math.floor(localT / legS) % segs;
  const inLeg = localT - segIdx * legS;

  const [x0, z0] = pts[segIdx];
  const [x1, z1] = pts[(segIdx + 1) % segs];

  if (inLeg < moveS) {
    const u = inLeg / moveS;
    const smooth = u * u * (3 - 2 * u);
    const x = x0 + (x1 - x0) * smooth;
    const z = z0 + (z1 - z0) * smooth;
    bot.mesh.position.set(x, surface.heightAt(x, z), z);
    bot.mesh.rotation.y = Math.atan2(x1 - x0, z1 - z0);
    tickArchetypeMesh(bot.mesh, time, 1.0, 0.0);
  } else {
    bot.mesh.position.set(x1, surface.heightAt(x1, z1), z1);
    tickArchetypeMesh(bot.mesh, time, 0.0, 1.0);
  }
}

export class ColonyStage3D {
  readonly vp: ColonyViewport;
  readonly surface: PlanetSurface;
  private readonly colonyGroup = new THREE.Group();
  private readonly buildings: THREE.Object3D[] = [];
  private readonly bots: BotRoute[] = [];
  private readonly foliageTimeU: THREE.IUniform<number> = { value: 0 };
  private readonly baseCamPos = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly disposables: (() => void)[] = [];
  private simTime = 0;
  private speedIdx = 0;
  private readonly speeds = [1, 2, 4] as const;
  private aimX = 0;
  private aimY = 0;

  constructor(private readonly host: HTMLElement) {
    // Remove legacy 2D canvas if present so the WebGL viewport canvas owns the stage cleanly.
    host.querySelector('#colony-canvas')?.remove();

    this.vp = createColonyViewport(host);
    const spec = PLANET_SPECS.oceanForest;
    this.surface = createPlanetSurface(spec, { quality: 'high' });
    this.vp.scene.add(this.surface.group);
    applyPlanetLook(this.vp, spec);

    const site = findShorelineSite(this.surface);
    this.populateColony(site, spec.biomeKey);
    this.vp.scene.add(this.colonyGroup);
    host.classList.add('is-live');
  }

  private populateColony(site: ShorelineSite, biomeKey: string): void {
    const placeOnTerrain = (id: string, dx: number, dz: number, rotY: number): THREE.Object3D => {
      const mesh = createArchetypeMesh(id, biomeKey);
      const x = site.cx + dx;
      const z = site.cz + dz;
      mesh.position.set(x, this.surface.heightAt(x, z), z);
      mesh.rotation.y = rotY;
      this.colonyGroup.add(mesh);
      this.buildings.push(mesh);
      return mesh;
    };

    // 1. HQ building (Command Hub) on the shoreline terrace
    const hq = placeOnTerrain('building.commandHub', 0, 0, 0.35);
    // 2. Solar Panel (Solar Array)
    const solar = placeOnTerrain('building.solar', -4.4, -1.4, 0.55);
    // 3. Pylon linking HQ, Solar, and Metal Extractor
    const pylon = placeOnTerrain('building.pylon', -1.2, 2.6, 0.1);
    // 4. Metal Extractor (Mine) + Metal Deposit
    const mine = placeOnTerrain('building.mine', 4.4, -1.6, -0.45);
    placeOnTerrain('resource.metalDeposit', 5.7, -0.8, 0.8);

    const pylonTop = pylon.position.clone().add(new THREE.Vector3(0, 2.35, 0));
    const links = buildPowerLinks(pylonTop, [
      hq.position.clone().add(new THREE.Vector3(0, 1.8, 0)),
      solar.position.clone().add(new THREE.Vector3(0, 1.1, 0)),
      mine.position.clone().add(new THREE.Vector3(0, 1.7, 0)),
    ]);
    this.colonyGroup.add(links.group);
    this.disposables.push(links.dispose);

    const trees = addShorelineTrees(this.surface, site, this.foliageTimeU);
    this.colonyGroup.add(trees.group);
    this.disposables.push(trees.dispose);

    // 5. Two autonomous bots: Miner T1 + Builder T1
    const miner = createArchetypeMesh('robot.miner', biomeKey);
    const builder = createArchetypeMesh('robot.builder', biomeKey);
    this.colonyGroup.add(miner, builder);
    this.bots.push(
      {
        mesh: miner,
        waypoints: [
          [site.cx + 3.1, site.cz - 0.8],
          [site.cx + 1.5, site.cz + 1.4],
        ],
        speed: 1.55,
        pauseS: 1.8,
        phase: 0.4,
      },
      {
        mesh: builder,
        waypoints: [
          [site.cx - 3.1, site.cz - 0.2],
          [site.cx - 1.3, site.cz + 1.6],
          [site.cx - 1.4, site.cz - 1.8],
        ],
        speed: 1.4,
        pauseS: 1.5,
        phase: 2.1,
      },
    );

    // Frame the 28-deg telephoto isometric camera so colony, trees, and water shoreline are all prominent
    const baseY = this.surface.heightAt(site.cx, site.cz);
    this.lookTarget.set(
      site.cx + site.waterDirX * 2.2,
      baseY + 0.55,
      site.cz + site.waterDirZ * 2.2,
    );
    this.baseCamPos.set(
      this.lookTarget.x + 16.5,
      baseY + 13.5,
      this.lookTarget.z + 18.5,
    );
    this.vp.camera.position.copy(this.baseCamPos);
    this.vp.camera.lookAt(this.lookTarget);
  }

  setPointerAim(nx: number, ny: number): void {
    this.aimX = Math.max(-1, Math.min(1, nx));
    this.aimY = Math.max(-1, Math.min(1, ny));
  }

  cycleSpeed(): number {
    this.speedIdx = (this.speedIdx + 1) % this.speeds.length;
    return this.speed;
  }

  get speed(): number {
    return this.speeds[this.speedIdx];
  }

  get tickCount(): number {
    return Math.floor(this.simTime * 10);
  }

  step(dt: number): void {
    const scaledDt = dt * this.speed;
    this.simTime += scaledDt;
    this.foliageTimeU.value = this.simTime;
    this.surface.update(scaledDt, this.simTime);

    for (const b of this.buildings) {
      tickArchetypeMesh(b, this.simTime, 0, 1);
    }
    for (const bot of this.bots) {
      stepBotRoute(bot, this.surface, this.simTime);
    }

    const swayX = Math.sin(this.simTime * 0.22) * 0.65 + this.aimX * 1.4;
    const swayY = Math.cos(this.simTime * 0.18) * 0.35 - this.aimY * 0.9;
    this.vp.camera.position.set(
      this.baseCamPos.x + swayX,
      this.baseCamPos.y + swayY,
      this.baseCamPos.z - swayX * 0.4,
    );
    this.vp.camera.lookAt(this.lookTarget);
    this.vp.render();
  }

  start(onTick?: (stage: ColonyStage3D) => void): StageHost {
    const loop = new StageHost({
      elements: [this.host],
      onFrame: (dt) => {
        this.step(dt);
        onTick?.(this);
      },
      onResize: () => this.vp.resize(),
    });
    loop.start();
    if (loop.reduced) {
      this.step(0.016);
      onTick?.(this);
    }
    return loop;
  }

  dispose(): void {
    this.disposables.forEach((fn) => fn());
    this.surface.dispose();
    this.vp.dispose();
  }
}
