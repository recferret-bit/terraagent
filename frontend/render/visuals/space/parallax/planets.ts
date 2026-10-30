import * as THREE from 'three';
import { OBJ_VERT, GIANT_FRAG, RING_FRAG } from './shaders';
import type { ParallaxCtx, ParallaxPart } from './types';

/** Distant ringed gas giant + small ice dwarf, lit from the same sun. */
export function createDistantPlanets(ctx: ParallaxCtx): ParallaxPart {
  const sunDirW = ctx.sunDir.clone().normalize();
  const bodyMat = (a: number, b: number, seed: number) => new THREE.ShaderMaterial({
    vertexShader: OBJ_VERT, fragmentShader: GIANT_FRAG,
    uniforms: { uA: { value: new THREE.Color(a) }, uB: { value: new THREE.Color(b) }, uSunDir: { value: sunDirW }, uSeed: { value: seed }, uTime: { value: 0 } },
  });
  const giantMat = bodyMat(0xc9a67a, 0x7a4f3a, 3.7);
  const giantGeo = new THREE.SphereGeometry(1, 64, 40);
  const giant = new THREE.Group(); giant.position.set(-150, 2, -260); giant.rotation.set(0.35, 0, -0.45);
  const gBody = new THREE.Mesh(giantGeo, giantMat); gBody.scale.setScalar(21); gBody.renderOrder = -60;
  const ringMat = new THREE.ShaderMaterial({ vertexShader: OBJ_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uCol: { value: new THREE.Color(0xd9c4a0) } } });
  const ringGeo = new THREE.RingGeometry(1.35, 2.2, 96, 1);
  const ring = new THREE.Mesh(ringGeo, ringMat); ring.scale.setScalar(21); ring.rotation.x = -Math.PI / 2; ring.renderOrder = -59;
  giant.add(gBody, ring); ctx.group.add(giant);
  const dwarfMat = bodyMat(0x9fc4d8, 0xe8f2f8, 8.1);
  const dwarf = new THREE.Mesh(giantGeo, dwarfMat); dwarf.scale.setScalar(7.5); dwarf.position.set(150, -34, -340); dwarf.renderOrder = -61; ctx.group.add(dwarf);
  return {
    update(_dt, time) {
      giantMat.uniforms.uTime.value = time; dwarfMat.uniforms.uTime.value = time;
      gBody.rotation.y = time * 0.01; dwarf.rotation.y = time * 0.02;
    },
    dispose() { [giantMat, giantGeo, ringMat, ringGeo, dwarfMat].forEach((d) => d.dispose()); },
  };
}
