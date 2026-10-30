import * as THREE from 'three';
import { createSunFlare } from '../../visuals/space/SunFlare';
import { R } from './StageGlobes';

/** Stage lights + the fixed-on-screen sun with its mouse-reactive lens glow. */
export class SunRig {
  readonly sunLight = new THREE.DirectionalLight(0xfff0dc, 3.2);
  readonly hemi = new THREE.HemisphereLight(0x6f8fd0, 0x14101c, 0.35);
  readonly rim = new THREE.DirectionalLight(0x7aa8ff, 0.9);
  readonly flare = createSunFlare(0xfff0d8);
  readonly mouseS = new THREE.Vector2(0, 0);
  // Sun is FIXED on screen (placed far along a camera-space direction every frame); only the lens glow reacts to the mouse.
  private readonly SUN_NDC = new THREE.Vector2(0.86, 0.84);
  private readonly sunPos = new THREE.Vector3();
  private readonly sunDirCam = new THREE.Vector3();
  private readonly mouse = new THREE.Vector2(0, 0);
  private readonly onMove = (e: PointerEvent) => { this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1)); };

  constructor(scene: THREE.Scene, sunDir: THREE.Vector3) {
    window.addEventListener('pointermove', this.onMove);
    scene.add(this.flare.group);
    this.sunLight.position.copy(sunDir).multiplyScalar(60);
    this.rim.position.set(-30, 10, -25);
    scene.add(this.sunLight, this.hemi, this.rim);
  }

  smoothMouse(dt: number) { this.mouseS.lerp(this.mouse, 1 - Math.exp(-dt * 2.5)); }

  update(camera: THREE.PerspectiveCamera, time: number, planetPos: THREE.Vector3) {
    const { flare, SUN_NDC, sunPos, sunDirCam, mouseS } = this;
    // fixed-on-screen sun: far along a constant camera-space direction
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    sunDirCam.set(SUN_NDC.x * tanH * camera.aspect, SUN_NDC.y * tanH, -1).normalize().applyQuaternion(camera.quaternion);
    sunPos.copy(camera.position).addScaledVector(sunDirCam, 700);
    flare.setPosition(sunPos);
    flare.setOccluder(planetPos, R * 1.0);
    // lens glow only reacts to the mouse (ghost axis pivots on the cursor, flare excites as it nears the sun)
    flare.setPointer(mouseS.x, mouseS.y);
    const dd = Math.hypot((mouseS.x - SUN_NDC.x) * camera.aspect, mouseS.y - SUN_NDC.y);
    flare.setExcite(1 - THREE.MathUtils.smoothstep(dd, 0.15, 1.6));
    flare.update(camera, time);
  }

  dispose(scene: THREE.Scene) {
    window.removeEventListener('pointermove', this.onMove);
    this.flare.dispose();
    scene.remove(this.sunLight, this.hemi, this.rim);
  }
}
