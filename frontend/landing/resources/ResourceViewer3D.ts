// Live 3D model of the selected resource: the same kitbash archetypes, Unifier material and diorama viewport as the game.
import * as THREE from 'three';
import { createColonyViewport, type ColonyViewport } from '@terra/render/core/createColonyViewport';
import { StageHost, prefersReducedMotion } from '@terra/render/core/StageHost';
import { PLANET_SPECS } from '@terra/render/planets/PlanetSpec';
import { createArchetypeMesh, tickArchetypeMesh, type ArchetypeMesh } from '@terra/render/kitbash';
import { RES } from './data';
import { Pedestal } from './Pedestal';

const BG = 0x0b0d11;

export class ResourceViewer3D {
  private readonly vp: ColonyViewport;
  private readonly ped = new Pedestal();
  private readonly reduced = prefersReducedMotion();
  private readonly center = new THREE.Vector3(0, 0.6, 0);
  private tCenter = this.center.clone();
  private dist = 8; private tDist = 8;
  private mesh: ArchetypeMesh | null = null;
  private born = 0; private time = 0; private first = true;

  constructor(private readonly stageEl: HTMLElement, private readonly tagEl: HTMLElement | null) {
    const vp = this.vp = createColonyViewport(stageEl);
    const { scene, camera } = vp;
    camera.near = 2; camera.far = 150; camera.updateProjectionMatrix(); // tight depth range: no z-fighting on the pedestal
    vp.sun.shadow.normalBias = 0.04; vp.sun.shadow.bias = -0.001;
    scene.background = new THREE.Color(BG); (scene.fog as THREE.FogExp2).color.set(BG);
    scene.add(this.ped.group);
    new StageHost({ elements: [stageEl], onFrame: (dt) => this.frame(dt), onResize: () => vp.resize() }).start();
    stageEl.classList.add('is-live');
  }

  show(key: string) {
    const { vp, ped } = this, scene = vp.scene, r = RES[key];
    if (this.mesh) { scene.remove(this.mesh); this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
    const spec = PLANET_SPECS[r.biome];
    const mesh = this.mesh = createArchetypeMesh(r.archetype, spec.biomeKey);
    scene.add(mesh);
    ped.topMat.color.setHex(spec.palette.groundLow).lerp(new THREE.Color(BG), 0.8);
    vp.sun.color.set(spec.sky.sunColor); vp.sun.intensity = spec.sky.sunIntensity; // warm key per biome; sky/background stay HUD-dark
    (scene.fog as THREE.FogExp2).density = 0.004;
    const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 0.9), pr = Math.max(1.5, Math.hypot(size.x, size.z) * 0.5 + 0.3);
    ped.group.scale.set(pr, 1, pr);
    this.tCenter = new THREE.Vector3(0, size.y * 0.45, 0);
    this.tDist = (radius / Math.sin(THREE.MathUtils.degToRad(14))) * 1.35;
    this.born = this.time;
    if (this.first) { this.first = false; this.center.copy(this.tCenter); this.dist = this.tDist; }
    if (this.tagEl) this.tagEl.textContent = `LIVE RENDER · ${r.archetype} · ${(mesh.geometry.index ? mesh.geometry.index.count / 3 : mesh.geometry.attributes.position.count / 3).toLocaleString('en-US')} TRIS`;
    if (this.reduced) this.frame(0);
  }

  private frame(dt: number) {
    const { vp, center } = this, camera = vp.camera;
    this.time += dt;
    // ease the framing between models, then drift the camera around the pedestal
    const k = 1 - Math.exp(-dt * 5);
    center.lerp(this.tCenter, dt ? k : 1); this.dist += (this.tDist - this.dist) * (dt ? k : 1);
    const az = this.reduced ? 0.8 : 0.8 + this.time * 0.28, el = THREE.MathUtils.degToRad(26 + Math.sin(this.time * 0.35) * 3);
    const d = this.dist;
    camera.position.set(center.x + Math.cos(az) * Math.cos(el) * d, center.y + Math.sin(el) * d, center.z + Math.sin(az) * Math.cos(el) * d);
    camera.lookAt(center);
    if (this.mesh) {
      const a = Math.min(1, (this.time - this.born) / 0.45), e = 1 - Math.pow(1 - a, 3);
      this.mesh.scale.setScalar(Math.max(0.001, e)); // grow-in on swap
      tickArchetypeMesh(this.mesh, this.time);
    }
    vp.followShadow(center);
    vp.render();
  }
}
