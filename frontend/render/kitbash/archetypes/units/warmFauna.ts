import * as THREE from 'three';
import { buildMammalCore } from '../../greebles/organic/vertebrates';
import { smooth01 } from '../../greebles/organic/vertebrateColor';
import { sculptedLoft } from '../../greebles/organic/vertebrateLoft';
import type { KitbashBuilder, PartOptions, VertexColorFn } from '../../KitbashRegistry';
import type { V3 } from '../../greebles/unitParts';
import { register } from './common';
import { WARM_FAUNA_ENTRIES } from './warmFaunaSpecs';
import type { WarmFurRuffKind } from './warmFaunaTypes';

function addCanidCervidRuff(
  b: KitbashBuilder,
  kind: WarmFurRuffKind,
  neckPivot: V3,
  headAnim: PartOptions,
  bodyColor: VertexColorFn,
): boolean {
  if (kind === 'wolfCape') {
    b.addPart(
      sculptedLoft(
        [
          { y: neckPivot[1] + 0.102, z: neckPivot[2] - 0.042, rx: 0.090, ryTop: 0.048, ryBot: 0.024, ridge: 0.22 },
          { y: neckPivot[1] + 0.114, z: neckPivot[2] + 0.028, rx: 0.086, ryTop: 0.046, ryBot: 0.024, ridge: 0.22 },
          { y: neckPivot[1] + 0.114, z: neckPivot[2] + 0.096, rx: 0.066, ryTop: 0.034, ryBot: 0.018, ridge: 0.18 },
        ],
        8,
        6,
        4.7,
        0,
        { subdiv: 1, compactCaps: true, bodyNormalY: neckPivot[1] },
      ),
      'hullPrimary',
      { name: 'wolf dorsal cape ruff', vertexColor: bodyColor, ...headAnim },
    );
    b.addPart(
      sculptedLoft(
        [
          { y: neckPivot[1] - 0.024, z: neckPivot[2] + 0.024, rx: 0.116, ryTop: 0.048, ryBot: 0.094, keel: 0.30 },
          { y: neckPivot[1] + 0.004, z: neckPivot[2] + 0.068, rx: 0.104, ryTop: 0.044, ryBot: 0.078, keel: 0.28 },
          { y: neckPivot[1] + 0.030, z: neckPivot[2] + 0.110, rx: 0.086, ryTop: 0.036, ryBot: 0.056, keel: 0.24 },
        ],
        8,
        6,
        3.3,
        0,
        { subdiv: 1, compactCaps: true, bodyNormalY: neckPivot[1] },
      ),
      'hullPrimary',
      {
        name: 'wolf ventral neck ruff',
        vertexColor: (_pos, norm, _u, _v, zones, out) => {
          const prim = new THREE.Color(zones.hullPrimary.color);
          const sec = new THREE.Color(zones.hullSecondary.color);
          out.copy(prim).lerp(sec, smooth01(0.10, -0.55, norm.y) * 0.72);
        },
        ...headAnim,
      },
    );
    return true;
  }
  if (kind === 'stagMane') {
    const stagManeColor: VertexColorFn = (_pos, norm, _u, _v, zones, out) => {
      const prim = new THREE.Color(zones.hullPrimary.color);
      const sec = new THREE.Color(zones.hullSecondary.color);
      const dark = new THREE.Color(zones.rubberDark.color);
      out.copy(prim)
        .lerp(sec, smooth01(0.35, 0.85, Math.abs(norm.x)) * 0.24)
        .lerp(dark, smooth01(0.05, -0.65, norm.y) * 0.38);
    };
    b.addPart(
      sculptedLoft(
        [
          { y: neckPivot[1] + 0.004, z: neckPivot[2] + 0.022, rx: 0.088, ryTop: 0.042, ryBot: 0.142, keel: 0.22 },
          { y: neckPivot[1] + 0.056, z: neckPivot[2] + 0.062, rx: 0.080, ryTop: 0.036, ryBot: 0.118, keel: 0.22 },
          { y: neckPivot[1] + 0.112, z: neckPivot[2] + 0.102, rx: 0.068, ryTop: 0.030, ryBot: 0.088, keel: 0.20 },
        ],
        8,
        6,
        3.1,
        0,
        { subdiv: 2, compactCaps: true },
      ),
      'hullPrimary',
      { name: 'stag brisket mane fringe', vertexColor: stagManeColor, ...headAnim },
    );
    b.addPart(
      sculptedLoft(
        [
          { y: neckPivot[1] + 0.120, z: neckPivot[2] + 0.088, rx: 0.066, ryTop: 0.034, ryBot: 0.094, keel: 0.26 },
          { y: neckPivot[1] + 0.172, z: neckPivot[2] + 0.134, rx: 0.058, ryTop: 0.030, ryBot: 0.084, keel: 0.28 },
          { y: neckPivot[1] + 0.220, z: neckPivot[2] + 0.178, rx: 0.046, ryTop: 0.026, ryBot: 0.066, keel: 0.26 },
        ],
        6,
        6,
        5.2,
        0,
        { subdiv: 1, compactCaps: true },
      ),
      'hullPrimary',
      { name: 'stag throat beard', vertexColor: stagManeColor, ...headAnim },
    );
    return true;
  }
  return false;
}

function addUngulateCamelRuff(
  b: KitbashBuilder,
  kind: WarmFurRuffKind,
  neckPivot: V3,
  headAnim: PartOptions,
  bodyColor: VertexColorFn,
): boolean {
  const bodyOpts: PartOptions = { vertRig: { role: 1 } };
  if (kind === 'oryxRidge') {
    b.addPart(
      sculptedLoft(
        [
          { y: neckPivot[1] + 0.112, z: neckPivot[2] + 0.010, rx: 0.022, ryTop: 0.052, ryBot: 0.028, ridge: 0.55 },
          { y: neckPivot[1] + 0.180, z: neckPivot[2] + 0.090, rx: 0.020, ryTop: 0.048, ryBot: 0.026, ridge: 0.55 },
          { y: neckPivot[1] + 0.222, z: neckPivot[2] + 0.160, rx: 0.015, ryTop: 0.034, ryBot: 0.020, ridge: 0.50 },
        ],
        6,
        6,
        2.7,
        0,
        { subdiv: 1, compactCaps: true },
      ),
      'rubberDark',
      { name: 'dorsal neck mane ridge', ...headAnim },
    );
    return true;
  }
  if (kind === 'tapirCrest') {
    b.addPart(
      sculptedLoft(
        [
          { y: neckPivot[1] + 0.106, z: neckPivot[2] + 0.048, rx: 0.026, ryTop: 0.040, ryBot: 0.028, ridge: 0.46 },
          { y: neckPivot[1] + 0.130, z: neckPivot[2] + 0.114, rx: 0.024, ryTop: 0.044, ryBot: 0.026, ridge: 0.48 },
          { y: neckPivot[1] + 0.120, z: neckPivot[2] + 0.182, rx: 0.018, ryTop: 0.028, ryBot: 0.020, ridge: 0.42 },
        ],
        6,
        6,
        2.9,
        0,
        { subdiv: 1, compactCaps: true },
      ),
      'hullPrimary',
      { name: 'tapir nape crest', ...headAnim },
    );
    return true;
  }
  if (kind === 'camelHumpTuft') {
    b.addPart(
      sculptedLoft(
        [
          { y: 1.05, z: -0.22, rx: 0.118, ryTop: 0.068, ryBot: 0.056, ridge: 0.22 },
          { y: 1.13, z: -0.04, rx: 0.154, ryTop: 0.088, ryBot: 0.074, ridge: 0.20 },
          { y: 1.06, z: 0.12, rx: 0.120, ryTop: 0.068, ryBot: 0.056, ridge: 0.22 },
        ],
        8,
        6,
        6.1,
        0,
        { subdiv: 2, compactCaps: true, bodyNormalY: 0.83 },
      ),
      'hullPrimary',
      { name: 'dorsal hump wool crown', vertexColor: bodyColor, ...bodyOpts },
    );
    b.addPart(
      sculptedLoft(
        [
          { y: neckPivot[1] - 0.08, z: neckPivot[2] + 0.14, rx: 0.036, ryTop: 0.030, ryBot: 0.052, keel: 0.56 },
          { y: neckPivot[1] - 0.05, z: neckPivot[2] + 0.26, rx: 0.034, ryTop: 0.030, ryBot: 0.058, keel: 0.58 },
          { y: neckPivot[1] + 0.08, z: neckPivot[2] + 0.36, rx: 0.028, ryTop: 0.026, ryBot: 0.042, keel: 0.50 },
        ],
        6,
        6,
        4.3,
        0,
        { subdiv: 1, compactCaps: true },
      ),
      'hullPrimary',
      { name: 'ventral camel throat fringe', ...headAnim },
    );
    return true;
  }
  return false;
}

function addFurRuffDetail(
  b: KitbashBuilder,
  kind: WarmFurRuffKind,
  neckPivot: V3,
  headCenter: V3,
  headAnim: PartOptions,
  bodyColor: VertexColorFn,
): void {
  if (addCanidCervidRuff(b, kind, neckPivot, headAnim, bodyColor)) return;
  if (addUngulateCamelRuff(b, kind, neckPivot, headAnim, bodyColor)) return;
  if (kind === 'lynxCheek' || kind === 'lemurRuff' || kind === 'ursineRuff') {
    const isBear = kind === 'ursineRuff';
    const isLemur = kind === 'lemurRuff';
    const zone = isBear ? 'hullPrimary' : 'hullSecondary';
    const w0 = isBear ? 0.044 : isLemur ? 0.025 : 0.032;
    const x0 = isBear ? 0.132 : isLemur ? 0.048 : 0.068;
    const x1 = isBear ? 0.178 : isLemur ? 0.076 : 0.108;
    const dy1 = isBear ? -0.048 : isLemur ? -0.022 : -0.042;
    for (const side of [-1, 1] as const) {
      b.addPart(
        sculptedLoft(
          [
            { x: headCenter[0] + side * x0, y: headCenter[1] + 0.004, z: headCenter[2] + 0.008, rx: w0, ryTop: w0 * 1.15, ryBot: w0 * 0.95 },
            { x: headCenter[0] + side * x1, y: headCenter[1] + dy1, z: headCenter[2] - 0.018, rx: w0 * 0.65, ryTop: w0 * 0.85, ryBot: w0 * 0.72, ridge: 0.35 },
          ],
          6,
          6,
          4.1 + side,
          0,
          { subdiv: 1, compactCaps: true },
        ),
        zone,
        {
          name: `${side > 0 ? 'right' : 'left'} lynx cheek ruff`,
          ...headAnim,
        },
      );
    }
  }
}

for (const entry of WARM_FAUNA_ENTRIES) {
  register({
    id: entry.id,
    label: entry.label,
    category: 'fauna',
    biosphere: true,
    footprint: [1, 1],
    zones: entry.zones,
    notes: entry.notes,
    build: (b) => {
      const { neckPivot, headCenter, headAnim, bodyColor } = buildMammalCore(b, entry.spec);
      if (entry.furRuff) {
        addFurRuffDetail(b, entry.furRuff, neckPivot, headCenter, headAnim, bodyColor);
      }
      if (entry.antlers) {
        b.addGreeble('cervineAntlers', {
          neckPivot,
          ...entry.antlers,
        });
      }
      if (entry.horns) {
        b.addGreeble('sweptHorns', {
          neckPivot,
          ...entry.horns,
        });
      }
    },
  });
}
