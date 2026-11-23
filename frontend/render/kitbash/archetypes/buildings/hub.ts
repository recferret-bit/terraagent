// Command hub + claim beacon.
import * as THREE from 'three';
import { KitbashBuilder, type MaterialZoneId, type MaterialZoneSpec } from '../../KitbashRegistry';
import { box, cyl, ring, strut, cable, lamp, dish, plinth, type V3, spin } from './kit';

const PI = Math.PI;

function addHubFoundationAndHull(b: KitbashBuilder, compact = false) {
  // Grounded octagonal plinth flush at Y = 0.000
  box(b, 'frameGunmetal', [6, 0.2, 6], [0, 1e-5, 0], { r: 0.08, seg: 1, name: 'foundation plinth', role: 'plinth' });
  const iw = 5.7, id = 5.7, role = 'plinthDetail' as const;
  for (const s of [-1, 1]) {
    b.addPart(new THREE.BoxGeometry(iw, 0.04, 0.1), 'hullSecondary', { name: 'plinth border Z', role, position: [0, 0.2, s * id / 2] });
    b.addPart(new THREE.BoxGeometry(0.1, 0.044, id - 0.04), 'hullSecondary', { name: 'plinth border X', role, position: [s * iw / 2, 0.202, 0] });
  }
  // Main hull + waist band + upper hull + dome drum + dome + ribs
  box(b, 'hullPrimary', [4.4, 1.34, 4.2], [-0.2, 0.16, -0.2], { r: 0.16, seg: 1, name: 'command lower hull' });
  box(b, 'frameGunmetal', [4.5, 0.18, 4.3], [-0.2, 1.1, -0.2], { r: 0.04, seg: 1, name: 'hull waist band' });
  box(b, 'hullPrimary', [3.8, 0.65, 3.6], [-0.2, 1.4, -0.2], { r: 0.14, seg: 1, name: 'command upper hull' });
  cyl(b, 'hullPrimary', 1.5, 1.7, 0.77, [-0.2, 1.96, -0.2], { seg: compact ? 10 : 14, name: 'dome drum' });
  ring(b, 'energyCyan', 1.52, 0.06, [-0.2, 2.72, -0.2], { seg: compact ? 10 : 14, tubeSeg: compact ? 3 : 4, name: 'dome collar light' });
  b.addPart(new THREE.SphereGeometry(1.38, compact ? 10 : 12, compact ? 5 : 6, 0, PI * 2, 0, PI / 2), 'glassVisor', { name: 'dome canopy glass', position: [-0.2, 2.68, -0.2] });
  for (let i = 0; i < 4; i++) {
    b.addPart(new THREE.TorusGeometry(1.39, 0.035, compact ? 3 : 4, compact ? 8 : 10, PI), 'frameGunmetal', {
      name: 'dome arch',
      position: [-0.2, 2.68, -0.2],
      rotation: [0, (i * PI) / 4, 0],
    });
  }
  // Corner columns. Caps only: the hub does not carry a four-corner flood.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    cyl(b, 'frameGunmetal', 0.2, 0.26, 1.56, [-0.2 + sx * 2.2, 0.14, -0.2 + sz * 2.1], { seg: compact ? 6 : 8, name: 'corner column' });
    cyl(b, 'frameGunmetal', 0.18, 0.22, 0.1, [-0.2 + sx * 2.2, 1.62, -0.2 + sz * 2.1], { seg: 6, name: 'column cap' });
  }
  // Front entry airlock
  box(b, 'frameGunmetal', [1.6, 1.02, 0.34], [-0.2, 0.18, 1.92], { r: 0.06, seg: 1, name: 'entry airlock' });
  b.addPart(new THREE.BoxGeometry(1.2, 0.15, 0.06), 'energyCyan', { name: 'airlock header light', position: [-0.2, 0.825, 2.08], emissiveIntensity: 3.8 });
  b.addPart(new THREE.BoxGeometry(0.12, 0.7, 0.06), 'energyCyan', { name: 'airlock frame light L', position: [-0.9, 0.63, 2.08] });
  b.addPart(new THREE.BoxGeometry(0.12, 0.7, 0.06), 'energyCyan', { name: 'airlock frame light R', position: [0.5, 0.63, 2.08] });
}

function addHubTanks(b: KitbashBuilder, compact = false) {
  // Storage tanks (left-back) clear of the corner column and without degenerate pole caps
  for (const k of [0, 1]) {
    const tx = -1.9 + k * 0.95;
    cyl(b, 'hullSecondary', 0.38, 0.4, 1.65, [tx, 0.14, -2.45], { seg: compact ? 8 : 10, name: `storage tank ${k + 1}` });
    cyl(b, 'frameGunmetal', 0.24, 0.38, 0.16, [tx, 1.76, -2.45], { seg: compact ? 8 : 10, name: `tank cap ${k + 1}` });
  }
  if (compact) {
    strut(b, 'frameGunmetal', [-2.15, 1.12, -2.35], [-0.68, 1.12, -2.35], 0.085, { seg: 6, name: 'tank manifold' });
  } else {
    box(b, 'frameGunmetal', [1.85, 0.14, 0.36], [-1.42, 1.05, -2.35], { r: 0.03, seg: 1, name: 'tank manifold' });
  }
}

function addHubAntennaAndRadar(b: KitbashBuilder, compact = false) {
  // Main tall antenna (angled) + collars + guy cables
  if (compact) {
    cyl(b, 'hullSecondary', 0.24, 0.28, 0.52, [1.0, 1.85, -1.4], { seg: 6, name: 'antenna base' });
  } else {
    box(b, 'hullSecondary', [0.42, 0.52, 0.42], [1.0, 1.85, -1.4], { r: 0.06, seg: 1, name: 'antenna base' });
  }
  strut(b, 'frameGunmetal', [1.0, 1.9, -1.4], [1.35, 6.4, -1.75], 0.08, { seg: 6, name: 'antenna mast' });
  for (const h of [3.4, 4.6]) {
    const t = (h - 1.9) / 4.5;
    const pos: V3 = [1.0 + 0.35 * t, h, -1.4 - 0.35 * t];
    ring(b, 'hullSecondary', 0.09, 0.045, pos, { seg: compact ? 6 : 8, tubeSeg: compact ? 3 : 4, name: 'antenna collar' });
  }
  lamp(b, 'dangerCrimson', 0.13, [1.35, 6.46, -1.75], { hSeg: 4, emissiveIntensity: 4.2, name: 'antenna beacon light' });
  // Top of the mast to the top of the two columns beside it. Slack is about 7% of each span: a little longer than the straight line.
  cable(b, [1.38, 6.28, -1.8], [2.0, 1.68, -2.28], 0.33, 0.018, 'frameGunmetal', { seg: compact ? 8 : 12, points: 3, name: 'antenna guy cable rear' });
  cable(b, [1.3, 6.28, -1.68], [2.0, 1.68, 1.88], 0.41, 0.018, 'frameGunmetal', { seg: compact ? 8 : 12, points: 3, name: 'antenna guy cable front' });
  // Rotating radar tower (left-front top)
  if (compact) {
    cyl(b, 'hullSecondary', 0.48, 0.54, 0.36, [-1.4, 1.99, 0.7], { seg: 6, name: 'radar pedestal' });
  } else {
    box(b, 'hullSecondary', [0.9, 0.36, 0.9], [-1.4, 1.99, 0.7], { r: 0.05, seg: 1, name: 'radar pedestal' });
  }
  cyl(b, 'frameGunmetal', 0.12, 0.2, 1.92, [-1.4, 2.3, 0.7], { seg: compact ? 6 : 8, name: 'radar mast' });
  dish(b, 0.85, [-1.4, 4.19, 0.7], -0.55, { seg: compact ? 8 : 10, ...spin(-1.4, 0.7) });
  cyl(b, 'frameGunmetal', 0.05, 0.05, 0.5, [-1.4, 4.09, 0.7], { seg: 6, name: 'radar feed rod', ...spin(-1.4, 0.7) });
  b.addPart(new THREE.BoxGeometry(0.1, 0.1, 0.1), 'energyCyan', {
    name: 'radar feed light',
    position: [-1.4, 4.57, 0.7],
    ...spin(-1.4, 0.7),
  });
}

/** Where the Tier 1+ uplink beam leaves the hub (model space, before the plinth strip): the top of the emitter housing. */
export const HUB_UPLINK_ORIGIN: V3 = [-0.2, 4.34, -0.2];

/** Orbital azure tech trim (Tier 1-2). Distinguishes the Uplink Relay Hub from the Tier 0 orange field bunker. */
export const HUB_UPLINK_TRIM: MaterialZoneSpec = { color: 0x2b82c9, roughness: 0.34, metalness: 0.45, emissiveIntensity: 0 };

/** Lustrous sovereign gold trim (Tier 3+). Replaces the hub's `hullSecondary` accent zone for royal white-and-gold contrast. */
export const HUB_GOLD_TRIM: MaterialZoneSpec = { color: 0xffc82b, roughness: 0.22, metalness: 0.94, emissiveIntensity: 0 };

export interface CommandHubOptions {
  /** Tier 1+: Quantum Dish, orbital focusing superstructure and dome uplink emitter (beam is a render effect). */
  uplink?: boolean;
  /** Tier 3+: Towering 4-rib sovereign cathedral spire, bastion obelisks, portico and winged citadel fins. */
  citadel?: boolean;
  /** Zone overrides, e.g. the azure or gold trim. Baked into the vertices, so a variant is its own catalog id. */
  zones?: Partial<Record<MaterialZoneId, MaterialZoneSpec>>;
  /** Parts (by name) that move into the accent zone, so the zone override reaches structural ribs, bands and caps. */
  trimParts?: ReadonlySet<string>;
}

/** Tier 3+ gold trim: prominent structural bands, dome arches, pedestals and caps join the sovereign gold accent zone. */
export const HUB_GOLD_TRIM_PARTS: ReadonlySet<string> = new Set([
  'hull waist band', 'tank cap 1', 'tank cap 2', 'column cap', 'dome arch',
  'antenna collar', 'radar pedestal', 'quantum dish bearing collar', 'uplink emitter collar',
]);

/** Tier 0 Field HQ industrial outpost detail: orange armored airlock hood, flank cooling radiator bays, tank collars and roof field-comms module. */
function addBaseOutpostDetail(b: KitbashBuilder) {
  // Armored orange hazard hood & side bumper bollards framing the front entry airlock (clear of header/frame lights)
  box(b, 'hullSecondary', [1.84, 0.18, 0.42], [-0.2, 1.16, 1.94], { r: 0.03, seg: 1, name: 'airlock hazard hood' });
  for (const sx of [-1, 1]) {
    b.addPart(new THREE.BoxGeometry(0.22, 0.96, 0.24), 'hullSecondary', { name: 'airlock bumper rib', position: [-0.2 + sx * 0.85, 0.66, 1.88] });
  }
  // Flank industrial heat-exchanger bays with triple orange cooling slats on the lower hull sides
  for (const [side, hx, lx] of [['L', -2.44, -2.53], ['R', 2.04, 2.13]] as const) {
    b.addPart(new THREE.BoxGeometry(0.22, 0.72, 1.88), 'frameGunmetal', { name: `flank cooling housing ${side}`, position: [hx, 0.68, -0.2] });
    for (let i = 0; i < 3; i++) {
      b.addPart(new THREE.BoxGeometry(0.08, 0.095, 1.62), 'hullSecondary', {
        name: `flank cooling fin ${side} ${i + 1}`,
        position: [lx, 0.48 + i * 0.2, -0.2],
      });
    }
  }
  // Roof field-comms utility module & whip sensor on the front-right upper deck (upgraded to Quantum Dish on Tier 1+)
  b.addPart(new THREE.BoxGeometry(0.64, 0.28, 0.6), 'frameGunmetal', { name: 'field comms housing', position: [1.26, 2.14, 1.12] });
  b.addPart(new THREE.BoxGeometry(0.52, 0.08, 0.48), 'hullSecondary', { name: 'field comms cover', position: [1.26, 2.28, 1.12] });
  cyl(b, 'frameGunmetal', 0.035, 0.05, 0.9, [1.38, 2.28, 1.22], { seg: 6, name: 'field comms aerial' });
  lamp(b, 'warningAmber', 0.07, [1.38, 3.22, 1.22], { hSeg: 4, emissiveIntensity: 3.8, name: 'field comms strobe light' });
  // Cryo storage tank structural retaining collars
  for (const k of [0, 1]) {
    const tx = -1.9 + k * 0.95;
    ring(b, 'frameGunmetal', 0.405, 0.04, [tx, 0.68, -2.45], { seg: 8, tubeSeg: 3, name: `tank strap ${k + 1}` });
  }
}

/** Quantum Dish: elevated roof tower, spinning oversized parabolic dish + feed boom + cyan beacon. */
function addQuantumDish(b: KitbashBuilder) {
  const x = 1.3, z = 1.2, S = spin(x, z);
  b.addPart(new THREE.BoxGeometry(0.64, 0.18, 0.64), 'hullSecondary', { name: 'quantum dish mount plate', position: [x, 2.07, z] });
  cyl(b, 'frameGunmetal', 0.11, 0.16, 1.02, [x, 2.12, z], { seg: 6, name: 'quantum dish mast' });
  cyl(b, 'hullSecondary', 0.2, 0.2, 0.12, [x, 3.08, z], { seg: 6, name: 'quantum dish bearing collar' });
  cyl(b, 'frameGunmetal', 0.065, 0.065, 0.36, [x, 3.16, z], { seg: 6, name: 'quantum dish spindle', ...S });
  dish(b, 0.70, [x, 3.44, z], -0.48, { seg: 8, name: 'quantum dish bowl', ...S });
  strut(b, 'frameGunmetal', [x, 3.5, z], [x, 3.98, z + 0.24], 0.032, { seg: 5, name: 'quantum dish feed boom', ...S });
  lamp(b, 'energyCyan', 0.085, [x, 4.04, z + 0.27], { hSeg: 4, emissiveIntensity: 4.5, name: 'quantum feed light', ...S });
}

/** Emitter on the dome apex: gunmetal housing overlapping the canopy and arches, cyan lens on top at HUB_UPLINK_ORIGIN. */
function addUplinkEmitter(b: KitbashBuilder) {
  const [x, , z] = HUB_UPLINK_ORIGIN;
  cyl(b, 'frameGunmetal', 0.28, 0.38, 0.34, [x, 3.88, z], { seg: 8, name: 'uplink emitter housing' });
  cyl(b, 'hullSecondary', 0.34, 0.34, 0.1, [x, 4.14, z], { seg: 8, name: 'uplink emitter collar' });
  cyl(b, 'energyCyan', 0.22, 0.22, 0.12, [x, 4.22, z], { seg: 8, emissiveIntensity: 4.6, name: 'uplink emitter lens light' });
}

/** Tier 1-2 Orbital Uplink superstructure: tri-pylon focusing cage, dual focus rings, telemetry flank pods & brow fairing. */
function addUplinkSuperstructure(b: KitbashBuilder) {
  const cx = -0.2, cz = -0.2;
  // 3-fold symmetry at 90, 210, 330 deg clears radar dish, quantum dish, antenna mast and guy cables.
  for (let i = 0; i < 3; i++) {
    const a = PI / 2 + (i * 2 * PI) / 3;
    const ca = Math.cos(a), sa = Math.sin(a);
    cyl(b, 'hullSecondary', 0.14, 0.18, 0.26, [cx + ca * 1.48, 2.48, cz + sa * 1.48], { seg: 6, name: 'uplink pylon base' });
    strut(b, 'frameGunmetal', [cx + ca * 1.48, 2.66, cz + sa * 1.48], [cx + ca * 1.0, 5.22, cz + sa * 1.0], 0.072, { seg: 5, name: 'uplink focus pylon lower' });
    strut(b, 'hullSecondary', [cx + ca * 1.0, 5.18, cz + sa * 1.0], [cx + ca * 0.74, 5.9, cz + sa * 0.74], 0.052, { seg: 5, name: 'uplink focus pylon upper' });
    cyl(b, 'energyCyan', 0.055, 0.055, 0.12, [cx + ca * 0.74, 5.86, cz + sa * 0.74], { seg: 6, emissiveIntensity: 4.4, name: 'uplink pylon beacon light' });
  }
  // Focus rings sit at Y = 5.22 and 5.88 — well above the spinning radar dish sweep (max Y ~ 4.88).
  ring(b, 'frameGunmetal', 1.0, 0.062, [cx, 5.22, cz], { seg: 12, tubeSeg: 4, name: 'uplink focus ring' });
  ring(b, 'energyCyan', 0.94, 0.036, [cx, 5.22, cz], { seg: 12, tubeSeg: 3, emissiveIntensity: 4.3, name: 'uplink focus halo light' });
  ring(b, 'hullSecondary', 0.74, 0.052, [cx, 5.88, cz], { seg: 12, tubeSeg: 4, name: 'uplink upper aperture ring' });

  // Armored front airlock telemetry brow
  b.addPart(new THREE.BoxGeometry(1.76, 0.16, 0.42), 'hullSecondary', { name: 'airlock telemetry brow', position: [-0.2, 1.24, 1.98] });
  b.addPart(new THREE.BoxGeometry(1.32, 0.06, 0.06), 'energyCyan', { name: 'airlock brow strip light', position: [-0.2, 1.24, 2.18], emissiveIntensity: 4.0 });

  // Twin side telemetry relay pods biting into the lower hull flanks
  for (const [side, hx, sx, lx] of [['L', -2.46, -2.61, -2.66], ['R', 2.06, 2.21, 2.26]] as const) {
    b.addPart(new THREE.BoxGeometry(0.28, 0.78, 2.0), 'frameGunmetal', { name: `flank telemetry pod ${side}`, position: [hx, 0.76, -0.2] });
    b.addPart(new THREE.BoxGeometry(0.1, 0.56, 1.76), 'hullSecondary', { name: `flank telemetry fairing ${side}`, position: [sx, 0.78, -0.2] });
    b.addPart(new THREE.BoxGeometry(0.06, 0.12, 1.56), 'energyCyan', { name: `flank telemetry strip ${side} light`, position: [lx, 0.78, -0.2], emissiveIntensity: 3.9 });
  }

  // Elevated telemetry spires on the two left corner columns (clear of right-side guy cables)
  for (const sz of [-2.3, 1.9]) {
    cyl(b, 'hullSecondary', 0.11, 0.15, 0.72, [-2.4, 1.68, sz], { seg: 6, name: 'corner telemetry spire' });
    cyl(b, 'energyCyan', 0.08, 0.08, 0.1, [-2.4, 2.36, sz], { seg: 6, emissiveIntensity: 4.1, name: 'corner telemetry cap light' });
  }
}

/** Tier 3+ Sovereign Citadel superstructure: towering 4-rib cathedral spire (Y=7.8m), triple crown halos, bastion obelisks, portico & flank shields. */
function addCitadelSuperstructure(b: KitbashBuilder) {
  const cx = -0.2, cz = -0.2;
  // 4-rib spire rotated +8 deg (45 deg either side of radar azimuth 143 deg) clears radar, quantum dish, antenna and guy cables.
  // Stepped radii (0.084 -> 0.062 -> 0.046) avoid grazing coplanar edges and read as tapered cathedral architecture.
  const deg = PI / 180;
  for (const aDeg of [8, 98, 188, 278]) {
    const a = aDeg * deg;
    const ca = Math.cos(a), sa = Math.sin(a);
    cyl(b, 'hullSecondary', 0.15, 0.21, 0.32, [cx + ca * 1.44, 2.48, cz + sa * 1.44], { seg: 4, name: 'spire rib base' });
    strut(b, 'hullSecondary', [cx + ca * 1.8, 1.98, cz + sa * 1.8], [cx + ca * 1.44, 2.66, cz + sa * 1.44], 0.115, { seg: 4, name: 'citadel wing buttress' });
    strut(b, 'frameGunmetal', [cx + ca * 1.44, 2.72, cz + sa * 1.44], [cx + ca * 0.96, 5.25, cz + sa * 0.96], 0.094, { seg: 4, name: 'spire rib lower' });
    strut(b, 'hullSecondary', [cx + ca * 0.96, 5.2, cz + sa * 0.96], [cx + ca * 0.78, 6.32, cz + sa * 0.78], 0.072, { seg: 4, name: 'spire rib mid' });
    strut(b, 'hullSecondary', [cx + ca * 0.78, 6.28, cz + sa * 0.78], [cx + ca * 0.56, 7.72, cz + sa * 0.56], 0.054, { seg: 4, name: 'spire lancet pinnacle' });
    b.addPart(new THREE.OctahedronGeometry(0.11, 0), 'warningAmber', {
      name: 'spire finial light',
      position: [cx + ca * 0.56, 7.76, cz + sa * 0.56],
      scale: [0.8, 1.5, 0.8],
      emissiveIntensity: 4.4,
    });
  }

  // Gilded dome mezzanine collar + 3 stacked Sovereign Crown Halos above the radar sweep (Y = 5.25, 6.30, 7.15).
  // Each inner emissive halo overlaps its outer structural crown ring by >= 2 cm so it is physically seated.
  ring(b, 'hullSecondary', 1.66, 0.095, [cx, 2.26, cz], { seg: 10, tubeSeg: 3, name: 'citadel dome collar' });
  ring(b, 'hullSecondary', 0.96, 0.074, [cx, 5.25, cz], { seg: 10, tubeSeg: 3, name: 'sovereign lower crown ring' });
  ring(b, 'energyCyan', 0.9, 0.044, [cx, 5.25, cz], { seg: 10, tubeSeg: 3, emissiveIntensity: 4.4, name: 'sovereign lower halo light' });
  ring(b, 'frameGunmetal', 0.78, 0.066, [cx, 6.3, cz], { seg: 10, tubeSeg: 3, name: 'sovereign mid collar ring' });
  ring(b, 'warningAmber', 0.73, 0.042, [cx, 6.3, cz], { seg: 10, tubeSeg: 3, emissiveIntensity: 4.2, name: 'sovereign mid halo light' });
  ring(b, 'hullSecondary', 0.65, 0.066, [cx, 7.15, cz], { seg: 10, tubeSeg: 3, name: 'sovereign apex crown ring' });
  ring(b, 'warningAmber', 0.6, 0.042, [cx, 7.15, cz], { seg: 10, tubeSeg: 3, emissiveIntensity: 4.6, name: 'sovereign apex halo light' });

  // Towering golden obelisk bastions on left corners + outward golden bastion buttresses on right corners (below guy cables)
  for (const sz of [-2.3, 1.9]) {
    cyl(b, 'hullSecondary', 0.14, 0.24, 1.55, [-2.4, 1.65, sz], { seg: 4, name: 'sovereign corner obelisk' });
    cyl(b, 'frameGunmetal', 0.19, 0.19, 0.14, [-2.4, 2.95, sz], { seg: 4, name: 'obelisk collar' });
    b.addPart(new THREE.OctahedronGeometry(0.13, 0), 'warningAmber', {
      name: 'obelisk pinnacle light',
      position: [-2.4, 3.26, sz],
      scale: [0.8, 1.4, 0.8],
      emissiveIntensity: 4.3,
    });
    b.addPart(new THREE.BoxGeometry(0.22, 1.06, 0.24), 'hullSecondary', { name: 'sovereign bastion buttress', position: [2.29, 0.74, sz] });
    b.addPart(new THREE.BoxGeometry(0.06, 0.74, 0.08), 'warningAmber', { name: 'bastion corner strip light', position: [2.4, 0.74, sz], emissiveIntensity: 4.0 });
  }

  // Grand Sovereign front entry portico flanking the airlock without obstructing airlock header/frame lights
  for (const sx of [-1, 1]) {
    strut(b, 'hullSecondary', [-0.2 + sx * 1.1, 0.2, 2.02], [-0.2 + sx * 0.96, 1.44, 1.98], 0.13, { seg: 4, name: 'portico cheek pillar' });
  }
  b.addPart(new THREE.BoxGeometry(2.38, 0.24, 0.48), 'hullSecondary', { name: 'sovereign portico arch', position: [-0.2, 1.38, 1.98] });
  b.addPart(new THREE.BoxGeometry(1.75, 0.08, 0.08), 'warningAmber', { name: 'sovereign portico crest light', position: [-0.2, 1.4, 2.22], emissiveIntensity: 4.2 });

  // Gilded tank strapping bands + sovereign flank armor shields
  for (const k of [0, 1]) {
    const tx = -1.9 + k * 0.95;
    ring(b, 'hullSecondary', 0.41, 0.045, [tx, 0.82, -2.45], { seg: 6, tubeSeg: 3, name: `tank gold band ${k + 1}` });
  }
  for (const [side, sx, lx] of [['L', -2.44, -2.56], ['R', 2.04, 2.16]] as const) {
    b.addPart(new THREE.BoxGeometry(0.24, 0.86, 2.1), 'hullSecondary', { name: `sovereign flank shield ${side}`, position: [sx, 0.74, -0.2] });
    b.addPart(new THREE.BoxGeometry(0.06, 0.14, 1.72), 'warningAmber', { name: `sovereign flank strip ${side} light`, position: [lx, 0.74, -0.2], emissiveIntensity: 4.1 });
  }
}

// ---------------------------------------------------------------- Command Hub (3x3)
export function commandHub(opts: CommandHubOptions = {}) {
  const b = new KitbashBuilder(opts.zones);
  const trim = opts.trimParts;
  if (trim) {
    const add = b.addPart.bind(b);
    b.addPart = (geo, zone, o = {}) => add(geo, o.name !== undefined && trim.has(o.name) ? 'hullSecondary' : zone, o);
  }
  const compact = Boolean(opts.uplink || opts.citadel);
  addHubFoundationAndHull(b, compact);
  addHubTanks(b, compact);
  addHubAntennaAndRadar(b, compact);
  if (opts.uplink) {
    addQuantumDish(b);
    addUplinkEmitter(b);
    if (opts.citadel) addCitadelSuperstructure(b);
    else addUplinkSuperstructure(b);
  } else {
    addBaseOutpostDetail(b);
  }
  return b.build();
}

// ---------------------------------------------------------------- Claim Beacon (1x1)
export function claimBeacon() {
  const b = new KitbashBuilder();
  plinth(b, 2, 2);
  cyl(b, 'hullPrimary', 0.5, 0.75, 0.52, [0, 0.18, 0], { seg: 8, name: 'obelisk pedestal' });
  ring(b, 'hullSecondary', 0.62, 0.05, [0, 0.62, 0], { seg: 8, name: 'pedestal collar' });
  cyl(b, 'frameGunmetal', 0.22, 0.34, 1.62, [0, 0.68, 0], { seg: 8, name: 'obelisk column' });
  for (const a of [0, 1, 2]) {
    const an = a * 2.094 + 0.4;
    strut(b, 'hullSecondary', [Math.cos(an) * 0.55, 0.62, Math.sin(an) * 0.55], [Math.cos(an) * 0.2, 2.1, Math.sin(an) * 0.2], 0.06, { name: `column buttress ${a + 1}` });
  }
  const A = spin(0, 0);
  cyl(b, 'frameGunmetal', 0.07, 0.09, 0.65, [0, 2.22, 0], { seg: 8, name: 'emitter spindle', ...A });
  b.addPart(new THREE.OctahedronGeometry(0.36, 0), 'energyCyan', { name: 'beacon crystal light', position: [0, 2.75, 0], scale: [0.8, 1.45, 0.8], emissiveIntensity: 4.0, ...A });
  strut(b, 'frameGunmetal', [-0.62, 2.75, 0], [0.62, 2.75, 0], 0.025, { name: 'upper ring spoke', ...A });
  ring(b, 'energyCyan', 0.62, 0.035, [0, 2.75, 0], { seg: 14, name: 'upper gyro ring light', rotation: [PI / 2 + 0.3, 0, 0], ...A });
  strut(b, 'frameGunmetal', [-0.5, 2.38, 0], [0.5, 2.38, 0], 0.025, { name: 'lower ring spoke', ...A });
  ring(b, 'warningAmber', 0.5, 0.03, [0, 2.38, 0], { seg: 14, name: 'lower gyro ring light', rotation: [PI / 2 - 0.25, 0, 0], ...A });
  // banner flag
  strut(b, 'frameGunmetal', [0.75, 0.18, -0.7], [0.75, 2.42, -0.7], 0.04, { name: 'banner mast' });
  box(b, 'hullSecondary', [0.04, 0.55, 0.72], [0.75, 1.75, -0.36], { r: 0.015, seg: 1, name: 'faction banner' });
  lamp(b, 'warningAmber', 0.07, [0.75, 2.44, -0.7], { name: 'banner mast light' });
  cable(b, [0.73, 2.3, -0.68], [0.18, 1.65, -0.18], 0.07, 0.02, 'frameGunmetal', { points: 3, name: 'banner guy cable' });
  return b.build();
}
