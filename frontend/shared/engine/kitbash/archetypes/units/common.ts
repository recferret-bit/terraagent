import * as THREE from 'three';
import { KitbashBuilder } from '../../KitbashRegistry';
import { ArchetypeCatalog, type ArchetypeCategory } from '../../catalog';
import '../../greebles/unitParts';

export function register(opts: {
  id: string;
  label: string;
  category: ArchetypeCategory;
  build: (b: KitbashBuilder) => void;
  footprint: [number, number];
  notes: string;
  /** Snap minY to 0 (default true). Ships opt out. */
  snap?: boolean;
  /** Uniform scale applied after build. */
  scale?: number;
}) {
  ArchetypeCatalog.register({
    id: opts.id,
    label: opts.label,
    category: opts.category,
    footprint: opts.footprint,
    notes: opts.notes,
    create: () => {
      const b = new KitbashBuilder();
      opts.build(b);
      const g = b.build();
      const pv = g.attributes.aPartAnim as THREE.BufferAttribute;
      const shiftPivot = (sc: number, dy: number) => {
        for (let i = 0; i < pv.count; i++) {
          pv.setY(i, pv.getY(i) * sc); pv.setZ(i, pv.getZ(i) * sc + dy); pv.setW(i, pv.getW(i) * sc);
        }
      };
      if (opts.scale) { g.scale(opts.scale, opts.scale, opts.scale); shiftPivot(opts.scale, 0); }
      if (opts.snap !== false) {
        g.computeBoundingBox();
        const minY = g.boundingBox!.min.y;
        if (Math.abs(minY) > 1e-5) { g.translate(0, -minY, 0); shiftPivot(1, -minY); }
        g.computeBoundingBox();
        g.computeBoundingSphere();
      }
      return g as THREE.BufferGeometry;
    },
  });
}
