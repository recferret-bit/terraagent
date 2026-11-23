import * as THREE from 'three';
import { bez, smoother, win } from '../stage/math';
import { R } from '../stage/StageGlobes';
import type { DeployHost } from './types';

export interface OrbitalCameraDiveOptions {
  readonly yaw?: number;
  readonly pitch?: number;
  readonly duration?: number;
}

interface CameraDiveState {
  elapsed: number;
  readonly duration: number;
  readonly p0: THREE.Vector3;
  readonly t0: THREE.Vector3;
  readonly c1: THREE.Vector3;
  readonly c2: THREE.Vector3;
  readonly endPos: THREE.Vector3;
  readonly endLook: THREE.Vector3;
  readonly fov0: number;
  readonly near0: number;
  readonly exp0: number;
  readonly bloom0: number;
  readonly shell0: number;
}

/**
 * Pod-free orbital zoom from the planet selection diorama straight through the atmosphere toward the player's
 * existing base sector (`isHomeBase`), ending at cloud entry for a seamless handoff to `RTSCamera.startOrbitalDrop`.
 */
export class OrbitalCameraDive {
  private state: CameraDiveState | null = null;

  constructor(private readonly host: DeployHost) {}

  get active(): boolean {
    return this.state !== null;
  }

  progress(): number {
    return this.state ? Math.min(1, this.state.elapsed / this.state.duration) : 0;
  }

  begin(opts: OrbitalCameraDiveOptions = {}): void {
    if (this.state) return;
    const { globes, camera, lookNow, viewport } = this.host;
    globes.settleForDeploy();
    const g = globes.current;
    const yaw = opts.yaw ?? 0;
    const pitch = opts.pitch ?? 0.08;
    const cp = Math.cos(pitch);
    const localNormal = new THREE.Vector3(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp).normalize();
    const worldNormal = localNormal.applyAxisAngle(new THREE.Vector3(0, 1, 0), g.spin.rotation.y).normalize();

    const planetPos = g.group.position.clone();
    const radius = R * g.group.scale.x;
    const surfacePoint = planetPos.clone().addScaledVector(worldNormal, radius);
    const endPos = surfacePoint.clone().addScaledVector(worldNormal, radius * 0.085);
    const endLook = surfacePoint.clone().addScaledVector(worldNormal, -radius * 0.14);

    const p0 = camera.position.clone();
    const c1 = p0.clone().lerp(endPos, 0.35).addScaledVector(worldNormal, radius * 0.25);
    const c2 = surfacePoint.clone().addScaledVector(worldNormal, radius * 0.55);
    const atmU = (g.atmosphere.material as THREE.ShaderMaterial).uniforms;

    this.state = {
      elapsed: 0,
      duration: Math.max(0.4, opts.duration ?? 1.55),
      p0,
      t0: lookNow.clone(),
      c1,
      c2,
      endPos,
      endLook,
      fov0: camera.fov,
      near0: camera.near,
      exp0: viewport.renderer.toneMappingExposure,
      bloom0: viewport.bloom.strength,
      shell0: (atmU?.uShell?.value as number | undefined) ?? 1.015,
    };
  }

  update(dt: number): void {
    const s = this.state;
    if (!s) return;
    const { camera, lookNow, sun, viewport, globes } = this.host;
    s.elapsed = Math.min(s.duration, s.elapsed + Math.max(0, dt));
    const u = s.elapsed / s.duration;
    const ep = Math.pow(u, 1.65);

    bez(s.p0, s.c1, s.c2, s.endPos, ep, camera.position);
    lookNow.lerpVectors(s.t0, s.endLook, smoother(Math.min(1, u * 1.15)));
    camera.lookAt(lookNow);

    camera.fov = THREE.MathUtils.lerp(s.fov0, 44, smoother(u));
    camera.near = THREE.MathUtils.lerp(s.near0, 0.03, u);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    sun.flare.setFade(1 - win(0, 0.45, u));
    const atmU = (globes.current.atmosphere.material as THREE.ShaderMaterial).uniforms;
    if (atmU?.uShell) atmU.uShell.value = s.shell0 + 0.03 * win(0.5, 1.0, u);
    globes.current.shared.uCloudNear?.value.set(
      win(0.55, 1.0, u) * 0.9,
      win(0.4, 1.0, u) * 1.8 + 0.0001,
    );

    viewport.bloom.strength = s.bloom0 + 0.35 * win(0.72, 1.0, u);
    viewport.renderer.toneMappingExposure = s.exp0 + 0.25 * win(0.75, 1.0, u);
  }

  dispose(): void {
    this.state = null;
  }
}
