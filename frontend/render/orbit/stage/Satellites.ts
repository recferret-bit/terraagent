import * as THREE from 'three';
import { acquireModel, tickArchetypeMesh, type FittedModel } from '../../visuals/space/placeholders';

interface Sat { model: FittedModel; orbit: number; period: number; incline: number; node: number; phase: number; plane: THREE.Euler }

const SAT_DEFS: [string, number, number, number, number, number, number][] = [
  // id, size, orbit, period(s), incline, node, phase
  ['prop.satComms', 1.8, 11.6, 34, 1.15, 0.2, 0.4],
  ['prop.satSolar', 2.1, 12.4, -48, 0.5, 1.9, 2.6],
  ['prop.stationRing', 2.5, 13.2, 70, -0.85, -0.7, 4.4],
  ['prop.satComms', 1.5, 12.0, -29, -0.3, 2.7, 5.5],
];

/** Artificial satellites: low fast orbits, nose along the velocity vector, solar wings broadside. */
export class Satellites {
  private readonly sats: Sat[] = [];
  private readonly tmp = new THREE.Vector3();
  private readonly ahead = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    for (const [id, size, orbit, period, incline, node, phase] of SAT_DEFS) {
      const model = acquireModel(id, 'dune', { size, mode: 'max', force: true });
      model.root.rotation.order = 'YXZ';
      scene.add(model.root);
      this.sats.push({ model, orbit, period, incline, node, phase, plane: new THREE.Euler(incline, node, 0, 'YXZ') });
    }
  }

  update(time: number, planetPos: THREE.Vector3) {
    const { tmp, ahead, up } = this;
    for (const st of this.sats) {
      const a = st.phase + (time / st.period) * Math.PI * 2;
      const dir = Math.sign(st.period);
      tmp.set(Math.cos(a) * st.orbit, 0, Math.sin(a) * st.orbit).applyEuler(st.plane);
      ahead.set(Math.cos(a + 0.05 * dir) * st.orbit, 0, Math.sin(a + 0.05 * dir) * st.orbit).applyEuler(st.plane);
      up.copy(tmp).normalize();
      st.model.root.position.copy(planetPos).add(tmp);
      st.model.root.up.copy(up);
      st.model.root.lookAt(ahead.add(planetPos));
      tickArchetypeMesh(st.model.mesh, time);
    }
  }

  dispose() { this.sats.forEach((x) => x.model.dispose()); }
}
