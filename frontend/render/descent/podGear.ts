import * as THREE from 'three';

/**
 * Flight configuration of the `ship.dropPod` archetype mesh, done on its own per-instance merged geometry
 * (`ArchetypeCatalog.getGeometry` returns a clone; parts are contiguous, non-indexed vertex ranges in
 * `geometry.userData.partRanges`, in build order):
 * - the archetype's built-in ablative shield + rim band (the first parts `podShell` builds, entirely in the base band)
 *   are skipped with a draw range while the drop rig's jettisonable shield covers the base, so the base never shows a
 *   double rim; they come back after the jettison and match the landed colony pod;
 * - the three landing legs (strut + foot pad, reaching the ground plane outside the hull) retract into their hull
 *   hinge for flight and extend once the shield is gone.
 * Anything that does not match (placeholder group, changed archetype) leaves the mesh untouched.
 */
export interface PodGear {
  setShieldAttached(attached: boolean): void;
  /** 0 = legs retracted into the hull, 1 = deployed as built. */
  setLegDeploy(deploy: number): void;
}

interface Range { start: number; count: number }
interface Stats { minY: number; maxY: number; maxR: number; az: number }
interface Leg { hinge: THREE.Vector3; verts: number[] }

const SHIELD_BAND_MAX_Y = 0.53;      // native metres: the built-in shield (0..0.5) and rim band (0.44..0.52)
const LEG_MIN_Y = 0.15, LEG_MIN_R = 1.45;
const STOWED_SCALE = 0.04;           // a retracted leg collapses to ~4 % of its length around the hinge (inside the hull)

const NOOP: PodGear = { setShieldAttached() {}, setLegDeploy() {} };

function measure(pos: THREE.BufferAttribute, r: Range): Stats {
  let minY = Infinity, maxY = -Infinity, maxR = 0, sx = 0, sz = 0;
  for (let v = r.start; v < r.start + r.count; v++) {
    const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y); maxR = Math.max(maxR, Math.hypot(x, z));
    sx += x; sz += z;
  }
  return { minY, maxY, maxR, az: Math.atan2(sz, sx) };
}

/** Leg parts (strut + pad) grouped by azimuth; the hinge is the top end of the group's strut. */
function findLegs(pos: THREE.BufferAttribute, ranges: Range[], stats: Stats[]): Leg[] {
  const groups: { az: number; parts: number[] }[] = [];
  stats.forEach((s, i) => {
    if (s.minY >= LEG_MIN_Y || s.maxR <= LEG_MIN_R) return;
    const g = groups.find((x) => Math.abs(Math.atan2(Math.sin(x.az - s.az), Math.cos(x.az - s.az))) < 0.5);
    if (g) g.parts.push(i); else groups.push({ az: s.az, parts: [i] });
  });
  return groups.map(({ parts }) => {
    const strut = parts.reduce((a, b) => (stats[b]!.maxY > stats[a]!.maxY ? b : a));
    const r = ranges[strut]!, top = stats[strut]!.maxY, hinge = new THREE.Vector3();
    let n = 0;
    for (let v = r.start; v < r.start + r.count; v++) {
      if (pos.getY(v) < top - 0.08) continue;
      hinge.x += pos.getX(v); hinge.y += pos.getY(v); hinge.z += pos.getZ(v); n++;
    }
    hinge.divideScalar(Math.max(1, n));
    const verts: number[] = [];
    for (const i of parts) for (let v = ranges[i]!.start; v < ranges[i]!.start + ranges[i]!.count; v++) verts.push(v);
    return { hinge, verts };
  });
}

export function createPodGear(mesh: THREE.Object3D): PodGear {
  const m = mesh as THREE.Mesh;
  const geo = m.isMesh ? m.geometry : null;
  const ranges = geo?.userData?.partRanges as Range[] | undefined;
  if (!geo || geo.index || !ranges?.length) return NOOP;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const stats = ranges.map((r) => measure(pos, r));

  let shieldEnd = 0;
  for (let i = 0; i < ranges.length && stats[i]!.maxY <= SHIELD_BAND_MAX_Y; i++) shieldEnd = ranges[i]!.start + ranges[i]!.count;
  const legs = findLegs(pos, ranges, stats);
  const rest = new Float32Array(pos.array as ArrayLike<number>);
  let lastScale = 1;

  return {
    setShieldAttached(attached) { geo.setDrawRange(attached ? shieldEnd : 0, Infinity); },
    setLegDeploy(deploy) {
      const s = STOWED_SCALE + (1 - STOWED_SCALE) * THREE.MathUtils.clamp(deploy, 0, 1);
      if (s === lastScale) return;
      lastScale = s;
      for (const { hinge, verts } of legs) {
        for (const v of verts) {
          pos.setXYZ(v, hinge.x + (rest[v * 3]! - hinge.x) * s, hinge.y + (rest[v * 3 + 1]! - hinge.y) * s, hinge.z + (rest[v * 3 + 2]! - hinge.z) * s);
        }
      }
      pos.needsUpdate = true;
    },
  };
}
