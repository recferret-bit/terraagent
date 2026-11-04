import { FAUNA_SPECIES_ZONES } from '../../faunaVisualRegistry';
import { type KitbashBuilder, type MaterialZoneId } from '../../KitbashRegistry';
import '../../greebles/faunaGreebles';
import { rbox, cyl, sph, strut, cable, mirror, lathe, type V3 } from '../../greebles/unitParts';
import { register } from './common';

// ---------------------------------------------------------------------------
// 1. fauna.hive.blackAnt — Low multi-tunnel crater mound (~2.6m wide, 2x2 tiles)
// ---------------------------------------------------------------------------

function addBlackAntMoundCoreAndTunnels(b: KitbashBuilder): void {
  b.addPart(
    lathe([[0.02, 0.0], [1.24, 0.0], [1.16, 0.24], [0.96, 0.56], [0.72, 0.82], [0.02, 0.82]], 14),
    'hullPrimary',
    { name: 'mound base crater hull', position: [0, 0, 0] },
  );
  b.addPart(cyl(0.68, 0.78, 0.16, 12), 'hullSecondary', {
    name: 'crater upper crown collar', position: [0, 0.86, 0],
  });
  b.addPart(cyl(0.48, 0.54, 0.10, 12), 'rubberDark', {
    name: 'crater recessed throat cavity', position: [0, 0.93, 0],
  });
  b.addPart(sph(0.11, 8, 6), 'dangerCrimson', {
    name: 'crater core pheromone light', position: [0, 0.98, 0], emissiveIntensity: 4.0,
  });

  const tunnels: Array<{ pos: V3; yaw: number; accent: MaterialZoneId }> = [
    { pos: [0.0, 0.0, 1.06], yaw: 0, accent: 'dangerCrimson' },
    { pos: [-0.92, 0.0, -0.50], yaw: -2.08, accent: 'warningAmber' },
    { pos: [0.90, 0.0, -0.54], yaw: 2.12, accent: 'warningAmber' },
  ];
  tunnels.forEach((t, i) => {
    b.addGreeble('hiveTunnelEntrance', {
      position: t.pos, yaw: t.yaw, width: 0.52, height: 0.44, depth: 0.34,
      accentZone: t.accent, name: `ant tunnel ${i + 1}`,
    });
  });

  b.addGreeble('hiveChimneyStack', {
    position: [0.56, 0.40, 0.46], height: 0.92, baseRadius: 0.24, topRadius: 0.15,
    accentZone: 'warningAmber', name: 'mound chimney spire',
  });
}

function addBlackAntBroodAndButtresses(b: KitbashBuilder): void {
  const broodSpots: Array<{ pos: V3; r: number }> = [
    { pos: [-0.60, 0.50, 0.50], r: 0.22 },
    { pos: [0.06, 0.48, -0.82], r: 0.24 },
    { pos: [-0.50, 0.66, -0.22], r: 0.19 },
  ];
  broodSpots.forEach((bs, i) => {
    b.addPart(sph(bs.r, 10, 8), 'hullSecondary', {
      name: `brood chamber dome ${i + 1}`, position: bs.pos, scale: [1.1, 0.72, 1.1],
    });
    b.addPart(rbox(bs.r * 1.4, 0.05, 0.08, 0.015, 1), 'frameGunmetal', {
      name: `brood dome seam strap ${i + 1}`, position: [bs.pos[0], bs.pos[1] + bs.r * 0.58, bs.pos[2]],
    });
  });

  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.52;
    const sx = Math.cos(a);
    const sz = Math.sin(a);
    strut(b, [sx * 1.12, 0.10, sz * 1.12], [sx * 0.66, 0.84, sz * 0.66], 0.055, 'frameGunmetal', {
      name: `mound chitin buttress ${i + 1}`,
    }, 0.04);
  }
}

register({
  id: 'fauna.hive.blackAnt',
  label: 'Black Ant Mound',
  category: 'fauna',
  footprint: [2, 2],
  zones: FAUNA_SPECIES_ZONES.blackAnt,
  notes:
    'Low crater mound with 3 radial tunnel entrances, trail aprons, recessed central crater throat, asymmetric chimney spire, brood chamber domes, and crimson/amber bio-markers.',
  build: (b) => {
    addBlackAntMoundCoreAndTunnels(b);
    addBlackAntBroodAndButtresses(b);
  },
});

// ---------------------------------------------------------------------------
// 2. fauna.hive.blueBeetle — Squat buttressed shell bunker (~2.8m wide, 2x2 tiles)
// ---------------------------------------------------------------------------

function addBlueBeetleBunkerShellAndSpire(b: KitbashBuilder): void {
  b.addPart(
    lathe([[0.02, 0.0], [1.30, 0.0], [1.24, 0.32], [1.04, 0.72], [0.68, 1.02], [0.02, 1.08]], 12),
    'hullPrimary',
    { name: 'bunker main carapace dome', position: [0, 0, 0] },
  );
  b.addGreeble('hiveTunnelEntrance', {
    position: [0, 0, 1.06], yaw: 0, width: 0.86, height: 0.62, depth: 0.44,
    accentZone: 'energyCyan', name: 'beetle bunker entrance',
  });
  b.addPart(rbox(1.16, 0.14, 0.86, 0.04, 1), 'hullSecondary', {
    name: 'dorsal molted carapace crown', position: [0, 1.04, -0.10], rotation: [-0.08, 0, 0],
  });
  b.addPart(rbox(0.24, 0.10, 0.92, 0.03, 1), 'frameGunmetal', {
    name: 'dorsal carapace suture spine', position: [0, 1.12, -0.10], rotation: [-0.08, 0, 0],
  });
  mirror((s) => {
    b.addPart(rbox(0.46, 0.12, 0.98, 0.035, 1), 'hullSecondary', {
      name: 'flank molted elytra shield', position: [0.84 * s, 0.62, -0.06], rotation: [0, 0.14 * s, -0.46 * s],
    });
    b.addPart(rbox(0.38, 0.10, 0.56, 0.03, 1), 'hullPrimary', {
      name: 'rear carapace armor plate', position: [0.46 * s, 0.56, -0.86], rotation: [0.42, -0.22 * s, 0],
    });
  });
  b.addPart(rbox(0.36, 0.34, 0.36, 0.06, 1), 'frameGunmetal', {
    name: 'dorsal spire base socket', position: [-0.32, 0.98, -0.44],
  });
  b.addPart(rbox(0.22, 0.68, 0.24, 0.05, 1), 'hullSecondary', {
    name: 'dorsal carapace horn spire', position: [-0.36, 1.38, -0.52], rotation: [-0.28, 0, 0.16],
  });
  b.addPart(sph(0.085, 8, 6), 'energyCyan', {
    name: 'spire bio beacon light', position: [-0.42, 1.70, -0.62], emissiveIntensity: 4.2,
  });
}

function addBlueBeetleButtressesAndPores(b: KitbashBuilder): void {
  const buttressAngles = [0.68, 1.55, 2.45, -2.45, -1.55, -0.68];
  buttressAngles.forEach((a, i) => {
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    b.addPart(rbox(0.22, 0.22, 0.34, 0.04, 1), 'frameGunmetal', {
      name: `buttress anchor block ${i + 1}`, position: [cx * 1.16, 0.12, cz * 1.16], rotation: [0, Math.atan2(cx, cz), 0],
    });
    strut(b, [cx * 1.16, 0.20, cz * 1.16], [cx * 0.74, 0.88, cz * 0.74], 0.075, 'frameGunmetal', {
      name: `buttress rib strut ${i + 1}`,
    }, 0.055);
  });

  const pores: V3[] = [
    [0.90, 0.64, -0.06],
    [-0.90, 0.64, -0.06],
    [0.0, 0.56, -1.08],
    [0.42, 1.02, -0.42],
  ];
  pores.forEach((vp, i) => {
    b.addPart(sph(0.085, 8, 6), 'energyCyan', {
      name: `bunker brood pore light ${i + 1}`, position: vp, emissiveIntensity: 4.0,
    });
  });
}

register({
  id: 'fauna.hive.blueBeetle',
  label: 'Armored Beetle Nest',
  category: 'fauna',
  footprint: [2, 2],
  zones: FAUNA_SPECIES_ZONES.blueBeetle,
  notes:
    'Wide cobalt armored shell bunker with broad arched beetle entrance, recessed burrow cavity, 6 structural gunmetal buttresses, overlapping molted carapace plates, rooted dorsal horn spire, and cyan brood pores.',
  build: (b) => {
    addBlueBeetleBunkerShellAndSpire(b);
    addBlueBeetleButtressesAndPores(b);
  },
});

// ---------------------------------------------------------------------------
// 3. fauna.hive.greenSpitter — Ribbed chimney mound & acid basin (~2.7m wide, 2x2 tiles)
// ---------------------------------------------------------------------------

function addGreenSpitterMoundAndChimneys(b: KitbashBuilder): void {
  b.addPart(
    lathe([[0.02, 0.0], [1.18, 0.0], [1.12, 0.28], [0.92, 0.64], [0.64, 0.94], [0.02, 0.98]], 12),
    'hullPrimary',
    { name: 'spitter mound core hull', position: [-0.08, 0, -0.08] },
  );
  b.addGreeble('hiveChimneyStack', {
    position: [-0.24, 0.56, -0.26], height: 1.24, baseRadius: 0.28, topRadius: 0.18,
    accentZone: 'terraformEmerald', name: 'tall acid chimney',
  });
  b.addGreeble('hiveChimneyStack', {
    position: [0.36, 0.48, -0.44], height: 0.96, baseRadius: 0.23, topRadius: 0.15,
    accentZone: 'terraformEmerald', name: 'mid acid chimney',
  });
  b.addGreeble('hiveChimneyStack', {
    position: [-0.62, 0.34, 0.20], height: 0.78, baseRadius: 0.20, topRadius: 0.13,
    accentZone: 'warningAmber', name: 'short spore chimney',
  });
  b.addGreeble('hiveTunnelEntrance', {
    position: [-0.28, 0, 0.98], yaw: -0.22, width: 0.60, height: 0.50, depth: 0.38,
    accentZone: 'terraformEmerald', name: 'spitter burrow entrance',
  });
}

function addGreenSpitterBasinAndSacs(b: KitbashBuilder): void {
  const bx = 0.60;
  const bz = 0.56;
  b.addPart(cyl(0.54, 0.60, 0.18, 12), 'frameGunmetal', {
    name: 'acid basin outer coaming', position: [bx, 0.095, bz],
  });
  b.addPart(cyl(0.46, 0.48, 0.06, 12), 'hullSecondary', {
    name: 'acid basin chitin collar', position: [bx, 0.195, bz],
  });
  b.addPart(cyl(0.36, 0.36, 0.05, 12), 'terraformEmerald', {
    name: 'acid basin pool light', position: [bx, 0.23, bz], emissiveIntensity: 3.8,
  });
  b.addPart(sph(0.075, 8, 6), 'warningAmber', {
    name: 'acid basin spore bubble light', position: [bx + 0.12, 0.265, bz - 0.08], emissiveIntensity: 3.6,
  });

  const ribAngles = [0.25, 1.85, 2.85, -1.95, -0.85];
  ribAngles.forEach((angle, i) => {
    const cx = -0.08 + Math.cos(angle) * 0.96;
    const cz = -0.08 + Math.sin(angle) * 0.96;
    const tx = -0.08 + Math.cos(angle) * 0.42;
    const tz = -0.08 + Math.sin(angle) * 0.42;
    strut(
      b,
      [cx, 0.12, cz],
      [tx, 0.84, tz],
      0.06,
      i % 2 === 0 ? 'hullSecondary' : 'frameGunmetal',
      { name: `mound pressure rib ${i + 1}` },
      0.045,
    );
  });

  const sacs: Array<{ pos: V3; r: number }> = [
    { pos: [0.88, 0.44, -0.18], r: 0.18 },
    { pos: [-0.96, 0.40, -0.40], r: 0.18 },
    { pos: [-0.14, 0.46, -1.02], r: 0.19 },
  ];
  sacs.forEach((s, i) => {
    b.addPart(cyl(s.r * 0.85, s.r * 0.95, 0.06, 8), 'hullSecondary', {
      name: `resin sac cradle ${i + 1}`, position: [s.pos[0], s.pos[1] - s.r * 0.82, s.pos[2]],
    });
    b.addPart(sph(s.r, 10, 8), 'terraformEmerald', {
      name: `resin acid sac light ${i + 1}`, position: s.pos, emissiveIntensity: 3.6,
    });
  });

  cable(
    b,
    [[-0.14, 0.68, -0.16], [0.24, 0.46, 0.18], [0.44, 0.12, 0.42]] as V3[],
    0.028,
    'frameGunmetal',
    { name: 'acid basin feed conduit' },
  );
}

register({
  id: 'fauna.hive.greenSpitter',
  label: 'Acid Spitter Hive',
  category: 'fauna',
  footprint: [2, 2],
  zones: FAUNA_SPECIES_ZONES.greenSpitter,
  notes:
    'Ribbed emerald chimney mound with 3 staggered acid chimneys, front burrow entrance, recessed acid basin with glowing pool, clustered resin sacs, and peristaltic feed veins.',
  build: (b) => {
    addGreenSpitterMoundAndChimneys(b);
    addGreenSpitterBasinAndSacs(b);
  },
});
