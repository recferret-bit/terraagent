// Pure-Node brand icon & 1200x630 social card generator for frontend/public/.
// Run: node frontend/design/brand/generate.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  blendPixel,
  createCanvas,
  drawText,
  encodePng,
  fillCircle,
  fillPoly,
  fillRect,
  strokePoly,
  wrapPngAsIco,
} from './raster.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(HERE, '../../public');

const C_VOID = [7, 8, 10, 255];
const C_PLATE = [17, 19, 24, 255];
const C_DEEP = [11, 13, 17, 255];
const C_SEAM = [38, 43, 54, 255];
const C_ORANGE = [255, 106, 19, 255];
const C_ORANGE_HI = [255, 138, 61, 255];
const C_BLUE = [30, 91, 255, 255];
const C_BLUE_HI = [76, 130, 255, 255];
const C_HULL = [242, 244, 247, 255];
const C_STEEL = [138, 147, 162, 255];
const C_TERRA = [61, 220, 132, 255];

function drawEmblem(canvas, cx, cy, size) {
  const s = size / 64;
  const pt = (x, y) => [cx + (x - 32) * s, cy + (y - 32) * s];
  const outer = [pt(32, 2), pt(58, 17), pt(58, 47), pt(32, 62), pt(6, 47), pt(6, 17)];
  const inner = [pt(32, 8), pt(52, 19.5), pt(52, 44.5), pt(32, 56), pt(12, 44.5), pt(12, 19.5)];
  fillPoly(canvas, outer, C_VOID);
  strokePoly(canvas, outer, Math.max(2, 3.2 * s), C_ORANGE);
  fillPoly(canvas, inner, C_PLATE);
  strokePoly(canvas, inner, Math.max(1.2, 1.5 * s), C_SEAM);

  const ringPts = [];
  const rad = (-18 * Math.PI) / 180;
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const ex = 18 * Math.cos(a);
    const ey = 7.5 * Math.sin(a);
    ringPts.push(pt(32 + ex * Math.cos(rad) - ey * Math.sin(rad), 34 + ex * Math.sin(rad) + ey * Math.cos(rad)));
  }
  strokePoly(canvas, ringPts, Math.max(1.2, 2.0 * s), C_BLUE);

  const visor = [pt(16, 27), pt(48, 27), pt(44, 38), pt(20, 38)];
  fillPoly(canvas, visor, C_BLUE);
  strokePoly(canvas, visor, Math.max(1, 1.2 * s), C_BLUE_HI);
  fillRect(canvas, cx - 9 * s, cy - 1.5 * s, 18 * s, 4 * s, C_HULL);
  strokePoly(canvas, [pt(32, 10), pt(32, 22)], Math.max(2, 3.2 * s), C_ORANGE_HI, false);
  fillPoly(canvas, [pt(32, 25), pt(27.5, 19), pt(36.5, 19)], C_ORANGE);
  fillPoly(canvas, [pt(27, 43), pt(37, 43), pt(34.5, 50), pt(29.5, 50)], C_ORANGE);
  fillCircle(canvas, cx, cy - 21 * s, Math.max(1.4, 2.2 * s), C_HULL);
}

function renderIcon(size, opaqueBg, emblemScale = 1) {
  const bg = opaqueBg ? C_VOID : [0, 0, 0, 0];
  const canvas = createCanvas(size, size, bg);
  if (opaqueBg) {
    for (let y = 0; y < size; y += Math.max(8, Math.round(size / 12))) {
      fillRect(canvas, 0, y, size, 1, [17, 20, 28, 255]);
    }
  }
  drawEmblem(canvas, size / 2, size / 2, size * emblemScale);
  return canvas;
}

function renderOgCover() {
  const w = 1200;
  const h = 630;
  const canvas = createCanvas(w, h, C_VOID);
  for (let x = 0; x < w; x += 40) fillRect(canvas, x, 0, 1, h, [14, 17, 24, 255]);
  for (let y = 0; y < h; y += 40) fillRect(canvas, 0, y, w, 1, [14, 17, 24, 255]);

  const frame = [[48, 28], [1152, 28], [1172, 48], [1172, 582], [1152, 602], [48, 602], [28, 582], [28, 48]];
  fillPoly(canvas, frame, C_DEEP);
  strokePoly(canvas, frame, 3, C_SEAM);
  fillRect(canvas, 48, 28, 1104, 6, C_ORANGE);

  for (let x = 48; x < 1152; x += 36) {
    const x0 = Math.max(48, x);
    const x1 = Math.min(1152, x + 18);
    const x2 = Math.min(1152, x + 8);
    const x3 = Math.max(48, x - 10);
    if (x1 > x0) fillPoly(canvas, [[x0, 586], [x1, 586], [x2, 602], [x3, 602]], C_ORANGE);
  }
  fillRect(canvas, 0, 0, 28, h, C_VOID);
  fillRect(canvas, w - 28, 0, 28, h, C_VOID);
  strokePoly(canvas, frame, 3, C_SEAM);

  fillRect(canvas, 76, 86, 520, 34, C_PLATE);
  fillRect(canvas, 76, 86, 6, 34, C_ORANGE);
  drawText(canvas, 'AUTONOMOUS COLONY RTS ON NEAR', 96, 96, 2, C_ORANGE_HI);
  drawText(canvas, 'TERRA', 76, 154, 11, C_HULL);
  drawText(canvas, 'AGENT', 430, 154, 11, C_ORANGE);
  drawText(canvas, 'DROP ONE ROBOT. LEAVE. IT KEEPS BUILDING.', 76, 260, 3, C_STEEL);
  drawText(canvas, '24/7 COLONY SIM  ·  NEAR.AI TEE  ·  6 RUST CONTRACTS', 76, 314, 2, C_BLUE_HI);

  const pills = [
    ['NEP-245 CARGO', C_TERRA],
    ['DAY-1 STAKING', C_BLUE_HI],
    ['VERIFIABLE AI', C_ORANGE],
  ];
  pills.forEach(([label, color], idx) => {
    const px = 76 + idx * 212;
    fillRect(canvas, px, 420, 196, 48, C_PLATE);
    fillRect(canvas, px, 420, 196, 4, color);
    drawText(canvas, label, px + 14, 438, 2, C_HULL);
  });

  drawText(canvas, 'TERRAAGENT.FUN', 76, 524, 3, C_ORANGE_HI);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const gx = 960 + Math.cos(a) * 140;
    const gy = 305 + Math.sin(a) * 140;
    for (let r = -2; r <= 2; r++) blendPixel(canvas, Math.round(gx + r), Math.round(gy), C_SEAM);
  }
  drawEmblem(canvas, 960, 305, 290);
  return canvas;
}

export function generateBrandAssets() {
  mkdirSync(PUBLIC_DIR, { recursive: true });
  const png48 = encodePng(renderIcon(48, false, 0.94));
  writeFileSync(join(PUBLIC_DIR, 'favicon.ico'), wrapPngAsIco(png48, 48));
  writeFileSync(join(PUBLIC_DIR, 'favicon-96x96.png'), encodePng(renderIcon(96, false, 0.94)));
  writeFileSync(join(PUBLIC_DIR, 'apple-touch-icon.png'), encodePng(renderIcon(180, true, 0.78)));
  writeFileSync(join(PUBLIC_DIR, 'icon-192.png'), encodePng(renderIcon(192, true, 0.78)));
  writeFileSync(join(PUBLIC_DIR, 'icon-512.png'), encodePng(renderIcon(512, true, 0.78)));
  writeFileSync(join(PUBLIC_DIR, 'og-cover.png'), encodePng(renderOgCover()));
  console.log(`Generated brand favicons + og-cover.png in ${PUBLIC_DIR}`);
}

generateBrandAssets();
