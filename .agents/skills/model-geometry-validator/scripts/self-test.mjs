#!/usr/bin/env node
// Proves the validator catches what it claims to catch, on tiny synthetic models with a known answer.
//   node .agents/skills/model-geometry-validator/scripts/self-test.mjs
import { createServer } from 'vite';
import * as THREE from 'three';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const vite = await createServer({ root: resolve(root, 'frontend'), configFile: resolve(root, 'vite.config.ts'), logLevel: 'error', appType: 'custom', server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, include: [] } });
const { validateModel } = await vite.ssrLoadModule('/render/kitbash/validate/index.ts');

let idx = 0;
/** A part from a three.js geometry, placed in world space. */
function part(geo, pos, { rot = [0, 0, 0], anim = 0, pivot, zone = 'hullPrimary', name } = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(1, 1, 1)));
  const p = g.attributes.position, t = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { t[i * 3] = p.getX(i); t[i * 3 + 1] = p.getY(i); t[i * 3 + 2] = p.getZ(i); }
  const i = idx++;
  return { index: i, name: name ?? `${geo.type.replace('Geometry', '')}#${i}`, zone, kind: geo.type, animType: anim, pivot: pivot ?? pos, emissive: 0, tris: t };
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const model = (parts) => { idx = 0; return validateModel({ id: 't', label: 't', source: 'builder', parts: parts() }, { minParts: 1, appearance: false }); };
const codes = (r) => r.issues.filter((i) => i.severity !== 'info').map((i) => i.code);

const cases = [];
const t = (name, build, expect) => cases.push({ name, build, expect });
const ground = () => part(box(1, 0.2, 1), [0, 0.1, 0], { name: 'base' });

t('clean joint: block sunk 2 cm into the base', () => [ground(), part(box(0.4, 0.4, 0.4), [0, 0.38, 0], { name: 'top' })], (r) => codes(r).length === 0);
t('a rod sunk into a hull is NOT interpenetration', () => [ground(), part(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 12), [0, 0.4, 0], { name: 'rod' })], (r) => codes(r).length === 0);
t('floating block 3 cm above the base → HAIRLINE_GAP', () => [ground(), part(box(0.4, 0.4, 0.4), [0, 0.43, 0])], (r) => codes(r).includes('HAIRLINE_GAP') && !codes(r).includes('FLOATING_PART'));
t('floating block 40 cm above the base → FLOATING_PART', () => [ground(), part(box(0.4, 0.4, 0.4), [0, 0.9, 0])], (r) => codes(r).includes('FLOATING_PART'));
t('plate whose top is flush with the base top → COPLANAR_Z_FIGHT', () => [ground(), part(box(0.6, 0.05, 0.6), [0, 0.175, 0])], (r) => r.issues.some((i) => i.code === 'COPLANAR_Z_FIGHT'));
t('inset panel flush with its frame → COPLANAR_Z_FIGHT', () => [ground(), part(box(0.04, 0.5, 0.6), [0.3, 0.45, 0], { name: 'frame' }), part(box(0.02, 0.44, 0.54), [0.31, 0.45, 0], { name: 'cell' })], (r) => codes(r).includes('COPLANAR_Z_FIGHT'));
t('panel entirely inside its frame → BURIED_PART', () => [ground(), part(box(0.04, 0.5, 0.6), [0.3, 0.45, 0], { name: 'frame' }), part(box(0.02, 0.44, 0.54), [0.3, 0.45, 0], { name: 'cell' })], (r) => codes(r).includes('BURIED_PART'));
t('inset panel standing proud of its frame → clean', () => [ground(), part(box(0.04, 0.5, 0.6), [0.3, 0.45, 0], { name: 'frame' }), part(box(0.02, 0.44, 0.54), [0.325, 0.45, 0], { name: 'cell' })], (r) => codes(r).length === 0);
t('two similar blocks interpenetrating by 10 cm each way → CUTS_THROUGH', () => [ground(), part(box(0.4, 0.4, 0.4), [0, 0.38, 0], { name: 'A' }), part(box(0.4, 0.4, 0.4), [0.1, 0.48, 0.1], { name: 'B' })], (r) => codes(r).includes('CUTS_THROUGH'));
t('block held only by a cable draped over it is not supported', () => [ground(), part(box(0.3, 0.3, 0.3), [0, 0.5, 0], { name: 'held' }), part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-0.4, 0.2, 0), new THREE.Vector3(0, 0.68, 0), new THREE.Vector3(0.4, 0.2, 0)]), 16, 0.02, 6), [0, 0, 0], { name: 'cable' })], (r) => codes(r).some((c) => c === 'HAIRLINE_GAP' || c === 'FLOATING_PART'));
t('cable that ends on two parts and clears the third → clean', () => [ground(), part(box(0.2, 0.4, 0.2), [-0.4, 0.4, 0], { name: 'post A' }), part(box(0.2, 0.4, 0.2), [0.4, 0.4, 0], { name: 'post B' }), part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-0.4, 0.5, 0), new THREE.Vector3(0, 0.38, 0), new THREE.Vector3(0.4, 0.5, 0)]), 16, 0.02, 6), [0, 0, 0], { name: 'cable' })], (r) => codes(r).length === 0);
t('cable passing through a block → CABLE_CLIPS', () => [ground(), part(box(0.3, 0.4, 0.3), [0, 0.4, 0], { name: 'block' }), part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-0.5, 0.2, 0), new THREE.Vector3(0, 0.4, 0), new THREE.Vector3(0.5, 0.2, 0)]), 16, 0.02, 6), [0, 0, 0], { name: 'cable' })], (r) => codes(r).includes('CABLE_CLIPS'));
// a mast with a spinning arm; at rest the arm clears the wall (it lies along x, the wall is to its side), the sweep decides
const spinner = (wallZ) => () => [ground(), part(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 10), [0, 0.4, 0], { name: 'mast' }), part(box(0.54, 0.04, 0.06), [0, 0.7, 0], { name: 'arm', anim: 1, pivot: [0, 0.7, 0] }), part(box(0.8, 0.8, 0.1), [0, 0.5, wallZ], { name: 'wall' })];
t('spinning arm sweeping into a wall → ANIM_COLLISION', spinner(0.3), (r) => codes(r).includes('ANIM_COLLISION'));
t('spinning arm with clearance → clean', spinner(0.5), (r) => !codes(r).includes('ANIM_COLLISION'));
t('bobbing part dipping below the ground → ANIM_BELOW_GROUND', () => [ground(), part(box(0.2, 0.2, 0.2), [0, 0.1, 0.8], { name: 'hoverer', anim: 2 })], (r) => codes(r).includes('ANIM_BELOW_GROUND'));
t('lockstep spinners (same angle) never collide with each other', () => [ground(), part(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 10), [0, 0.4, 0]), part(box(0.5, 0.04, 0.06), [0, 0.7, 0], { name: 'arm A', anim: 1, pivot: [0, 0.7, 0] }), part(box(0.5, 0.04, 0.06), [0, 0.76, 0], { name: 'arm B', anim: 1, pivot: [0, 0.76, 0] })], (r) => !codes(r).includes('ANIM_COLLISION'));
const spider = (wallZ) => () => [ground(), part(box(0.3, 0.4, 0.3), [0, 0.38, 0], { name: 'hull' }), part(box(0.5, 0.06, 0.06), [0.35, 0.4, 0.1], { name: 'spider leg', anim: 6, pivot: [0.14, 0.4, 0.1] }), part(box(0.2, 0.4, 0.06), [0.5, 0.38, wallZ], { name: 'post' })];
t('spider leg (anim 6) sweeping into a nearby post → ANIM_COLLISION', spider(0.18), (r) => codes(r).includes('ANIM_COLLISION'));
t('spider leg (anim 6) with stride clearance → clean', spider(0.35), (r) => !codes(r).includes('ANIM_COLLISION'));
const biped = (armX) => () => [part(box(0.5, 0.2, 0.3), [0, 0.8, 0], { name: 'pelvis' }), part(box(0.12, 0.72, 0.06), [0.15, 0.36, 0], { name: 'leg', anim: 4, pivot: [0.15, 0.72, 0] }), part(box(0.1, 0.45, 0.06), [armX, 0.62, 0.09], { name: 'arm', anim: 5, pivot: [armX, 0.82, 0.09] })];
t('biped arm (anim 5) sweeping into biped leg (anim 4) → ANIM_COLLISION', biped(0.18), (r) => codes(r).includes('ANIM_COLLISION'));
t('biped arm (anim 5) and leg (anim 4) with lateral clearance → clean', biped(0.28), (r) => !codes(r).includes('ANIM_COLLISION'));
t('foundation sunk 10 cm below ground is allowed', () => [part(box(1, 0.4, 1), [0, 0.1, 0])], (r) => !codes(r).includes('GROUND_CONTACT'));
t('foundation sunk 30 cm below ground → GROUND_CONTACT', () => [part(box(1, 0.4, 1), [0, -0.1, 0])], (r) => codes(r).includes('GROUND_CONTACT'));
t('lowest point 12 cm above the ground → GROUND_CONTACT', () => [part(box(1, 0.2, 1), [0, 0.22, 0])], (r) => codes(r).includes('GROUND_CONTACT'));

// ---- appearance fixtures: colour fit, group separation, surface detail (appearance checks ON; geometry noise ignored)
const amodel = (parts) => { idx = 0; return validateModel({ id: 't', label: 't', source: 'builder', parts: parts() }, { minParts: 1, appearance: true }); };
const acodes = (r) => r.issues.map((i) => i.code);
const feat = (n, x, z, zone = 'hullSecondary') => part(box(0.1, 0.03, 0.1), [x, 0.05, z], { zone, name: n });
const base = (zone = 'frameGunmetal', name = 'platform') => part(box(1, 0.04, 1), [0, 0.02, 0], { zone, name });
const cylX = (r, len) => new THREE.CylinderGeometry(r, r, len, 12);
const frame = () => part(box(0.04, 0.5, 0.6), [0.3, 0.45, 0], { name: 'solar frame', zone: 'frameGunmetal' });
const grid = (n) => Array.from({ length: n }, (_, k) => part(box(0.014, 0.1, 0.1), [0.315, 0.3 + (k % 3) * 0.12, -0.14 + Math.floor(k / 3) * 0.12], { name: 'solar cell', zone: 'solarCell' }));
const at_ = [];
const a = (name, build, expect) => at_.push({ name, build, expect });
a('solar panel as one flat slab → ROLE_DETAIL', () => [base(), frame(), part(box(0.02, 0.44, 0.54), [0.325, 0.45, 0], { name: 'solar cells', zone: 'solarCell' })], (r) => acodes(r).includes('ROLE_DETAIL'));
a('solar panel with a 9-cell grid → no ROLE_DETAIL', () => [base(), frame(), ...grid(9)], (r) => !acodes(r).includes('ROLE_DETAIL'));
a('solar panel with only 3 cells → ROLE_DETAIL', () => [base(), frame(), ...grid(3)], (r) => acodes(r).includes('ROLE_DETAIL'));
a('bare wheel cylinder → ROLE_DETAIL', () => [base(), part(cylX(0.17, 0.12), [0, 0.35, 0], { name: 'wheel tyre', zone: 'rubberDark' })], (r) => acodes(r).includes('ROLE_DETAIL'));
a('wheel with a different-coloured hub → no ROLE_DETAIL', () => [base(), part(cylX(0.17, 0.12), [0, 0.35, 0], { name: 'wheel tyre', zone: 'rubberDark' }), part(cylX(0.06, 0.16), [0, 0.35, 0], { name: 'wheel hub', zone: 'hullSecondary' })], (r) => !acodes(r).includes('ROLE_DETAIL'));
const machine = (zWheel, zBase, zArm) => () => [part(box(1, 0.2, 1), [0, 0.1, 0], { name: 'chassis', zone: zBase }), part(cylX(0.2, 0.3), [0.6, 0.2, 0], { name: 'wheel', zone: zWheel }), part(cylX(0.2, 0.3), [-0.6, 0.2, 0], { name: 'wheel', zone: zWheel }), part(box(0.3, 0.3, 0.3), [0, 0.3, 0], { name: 'boom', zone: zArm })];
a('wheels, platform and manipulator in one zone → GROUP_SAME_COLOR', machine('frameGunmetal', 'frameGunmetal', 'frameGunmetal'), (r) => acodes(r).includes('GROUP_SAME_COLOR'));
a('wheels, platform and manipulator in three distinct zones → no GROUP_SAME_COLOR', machine('rubberDark', 'hullPrimary', 'hullSecondary'), (r) => !acodes(r).includes('GROUP_SAME_COLOR'));
const cart = (zWheel, zBase) => () => [part(box(1, 0.2, 1), [0, 0.1, 0], { name: 'chassis', zone: zBase }), part(cylX(0.2, 0.3), [0.6, 0.2, 0], { name: 'wheel', zone: zWheel }), part(cylX(0.2, 0.3), [-0.6, 0.2, 0], { name: 'wheel', zone: zWheel }), part(box(0.6, 0.4, 0.6), [0, 0.45, 0], { name: 'body hull', zone: 'hullPrimary' }), part(box(0.5, 0.2, 0.5), [0, 0.75, 0], { name: 'cabin', zone: 'hullPrimary' })];
a('near-black tyres touching a gunmetal chassis (dust makes both one tint low on a dune) → GROUP_SAME_COLOR', cart('rubberDark', 'frameGunmetal'), (r) => acodes(r).includes('GROUP_SAME_COLOR'));
a('near-black tyres on a light-coloured chassis → no GROUP_SAME_COLOR', cart('rubberDark', 'hullSecondary'), (r) => !acodes(r).includes('GROUP_SAME_COLOR'));
const plate = (zone) => () => [base('hullPrimary'), part(box(0.5, 0.02, 0.5), [0, 0.045, 0], { name: 'panel', zone })];
a('thin plate in the same colour as its base → LOW_CONTRAST_INSET', plate('hullPrimary'), (r) => acodes(r).includes('LOW_CONTRAST_INSET'));
a('thin plate in an accent colour → no LOW_CONTRAST_INSET', plate('hullSecondary'), (r) => !acodes(r).includes('LOW_CONTRAST_INSET'));
a('large blank top face → FLAT_SURFACE', () => [base()], (r) => acodes(r).includes('FLAT_SURFACE'));
a('same face carrying 4 features → no FLAT_SURFACE', () => [base(), feat('hatch A', -0.3, -0.3), feat('hatch B', 0.3, -0.3), feat('hatch C', -0.3, 0.3), feat('hatch D', 0.3, 0.3)], (r) => !acodes(r).includes('FLAT_SURFACE'));
a('one zone covering the whole model → PALETTE_FLAT', () => [base('hullPrimary'), part(box(0.4, 0.4, 0.4), [0, 0.2, 0], { zone: 'hullPrimary', name: 'top' })], (r) => acodes(r).includes('PALETTE_FLAT'));
a('no accent colour anywhere → NO_ACCENT', () => [base('hullPrimary'), part(box(0.4, 0.4, 0.4), [0, 0.4, 0], { zone: 'frameGunmetal', name: 'top' })], (r) => acodes(r).includes('NO_ACCENT'));
a('light that is not emissive → ROLE_ZONE', () => [base(), part(box(0.1, 0.1, 0.1), [0, 0.25, 0], { zone: 'hullPrimary', name: 'status light' })], (r) => acodes(r).includes('ROLE_ZONE'));

let fail = 0;
for (const c of at_) {
  const r = amodel(c.build);
  const ok = c.expect(r);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}${ok ? '' : `   → got [${acodes(r).join(', ') || 'nothing'}]`}`);
  if (!ok) fail++;
}
cases.length += at_.length;
for (const c of cases.slice(0, cases.length - at_.length)) {
  const r = model(c.build);
  const ok = c.expect(r);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}${ok ? '' : `   → got [${codes(r).join(', ') || 'nothing'}]`}`);
  if (!ok) fail++;
}
console.log(`\n${cases.length - fail}/${cases.length} validator self-tests pass`);
await vite.close();
process.exit(fail ? 1 : 0);
