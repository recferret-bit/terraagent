import * as THREE from 'three';
import { PLAYER_COLORS } from './terraform';

/** Colony beacons: one light pillar per player colony (in that player's colour) while a terraform step is running. */
export class ColonyBeams {
  readonly group = new THREE.Group();
  private readonly beam = { uBeam: { value: 0 } };
  private readonly geo: THREE.CylinderGeometry;
  private readonly mats: THREE.ShaderMaterial[];

  constructor(radius: number, colonies: THREE.Vector3[], uOpacity: THREE.IUniform<number>) {
    const beamH = radius * 0.3;
    this.geo = new THREE.CylinderGeometry(radius * 0.004, radius * 0.016, beamH, 10, 1, true).translate(0, beamH / 2, 0);
    this.mats = PLAYER_COLORS.map(([r, g, b]) => new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { ...this.beam, uOpacity, uColor: { value: new THREE.Vector3(r, g, b) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying vec2 vUv; uniform float uBeam, uOpacity; uniform vec3 uColor; void main(){ float a = pow(1.0 - vUv.y, 1.7) * uBeam * uOpacity; gl_FragColor = vec4(uColor * 2.2, a); }',
    }));
    this.group.visible = false;
    colonies.forEach((p, i) => {
      const b = new THREE.Mesh(this.geo, this.mats[i]); b.renderOrder = 4; b.frustumCulled = false;
      b.position.copy(p).multiplyScalar(radius);
      b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p);
      this.group.add(b);
    });
  }

  setStrength(v: number) { this.beam.uBeam.value = v; this.group.visible = v > 0.01; }

  dispose() { this.geo.dispose(); this.mats.forEach((m) => m.dispose()); }
}
