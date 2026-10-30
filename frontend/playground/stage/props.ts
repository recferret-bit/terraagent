import * as THREE from 'three';
import { textSprite } from './textSprite';

/** 0-5 m ruler with tick labels, placed along the +X edge. */
export function buildRuler(): THREE.Group {
  const group = new THREE.Group();
  const verts: number[] = [];
  for (let i = 0; i <= 5; i++) verts.push(i, 0.01, 0, i, 0.01 + 0.14 + (i === 5 ? 0.1 : 0), 0);
  verts.push(0, 0.01, 0, 5, 0.01, 0);
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  group.add(new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xff8a3d })));
  for (let i = 0; i <= 5; i++) { const sp = textSprite(i + 'm', '#ff8a3d'); sp.position.set(i, 0.45, 0); group.add(sp); }
  group.position.set(-2.5, 0, 5.1);
  return group;
}

/** 1.8 m translucent human scale reference. */
export function buildHuman(): THREE.Group {
  const group = new THREE.Group();
  const hm = new THREE.MeshStandardMaterial({ color: 0x39d0ff, transparent: true, opacity: 0.35, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.0, 4, 12), hm); body.position.y = 0.72;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), hm); head.position.y = 1.67;
  group.add(body, head);
  const lbl = textSprite('1.8m', '#39d0ff'); lbl.position.y = 2.1; group.add(lbl);
  return group;
}
