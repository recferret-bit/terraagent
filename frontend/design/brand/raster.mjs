// Pure-Node RGBA rasterizer, PNG encoder, and ICO packer (zero native dependencies).
import { crc32, deflateSync } from 'node:zlib';
import { FONT_5X7 } from './font5x7.mjs';

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function createCanvas(width, height, bg = [7, 8, 10, 255]) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    data[o] = bg[0];
    data[o + 1] = bg[1];
    data[o + 2] = bg[2];
    data[o + 3] = bg[3];
  }
  return { width, height, data };
}

export function blendPixel(canvas, x, y, rgba) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const a = rgba[3] / 255;
  if (a <= 0) return;
  const o = (y * canvas.width + x) * 4;
  if (a >= 1 || canvas.data[o + 3] === 0) {
    canvas.data[o] = rgba[0];
    canvas.data[o + 1] = rgba[1];
    canvas.data[o + 2] = rgba[2];
    canvas.data[o + 3] = rgba[3];
    return;
  }
  const inv = 1 - a;
  canvas.data[o] = Math.round(rgba[0] * a + canvas.data[o] * inv);
  canvas.data[o + 1] = Math.round(rgba[1] * a + canvas.data[o + 1] * inv);
  canvas.data[o + 2] = Math.round(rgba[2] * a + canvas.data[o + 2] * inv);
  canvas.data[o + 3] = Math.min(255, Math.round(rgba[3] + canvas.data[o + 3] * inv));
}

export function fillRect(canvas, x0, y0, w, h, rgba) {
  const sx = Math.max(0, Math.floor(x0));
  const sy = Math.max(0, Math.floor(y0));
  const ex = Math.min(canvas.width, Math.ceil(x0 + w));
  const ey = Math.min(canvas.height, Math.ceil(y0 + h));
  for (let y = sy; y < ey; y++) {
    for (let x = sx; x < ex; x++) blendPixel(canvas, x, y, rgba);
  }
}

export function fillCircle(canvas, cx, cy, r, rgba) {
  const sx = Math.max(0, Math.floor(cx - r));
  const ex = Math.min(canvas.width - 1, Math.ceil(cx + r));
  const sy = Math.max(0, Math.floor(cy - r));
  const ey = Math.min(canvas.height - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = sy; y <= ey; y++) {
    for (let x = sx; x <= ex; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) blendPixel(canvas, x, y, rgba);
    }
  }
}

function pointInPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    const intersect = (yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function fillPoly(canvas, pts, rgba) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const sx = Math.max(0, Math.floor(Math.min(...xs)));
  const ex = Math.min(canvas.width - 1, Math.ceil(Math.max(...xs)));
  const sy = Math.max(0, Math.floor(Math.min(...ys)));
  const ey = Math.min(canvas.height - 1, Math.ceil(Math.max(...ys)));
  for (let y = sy; y <= ey; y++) {
    for (let x = sx; x <= ex; x++) {
      if (pointInPoly(x + 0.5, y + 0.5, pts)) blendPixel(canvas, x, y, rgba);
    }
  }
}

export function strokePoly(canvas, pts, width, rgba, closed = true) {
  const half = width / 2;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const pad = Math.ceil(half + 1);
  const sx = Math.max(0, Math.floor(Math.min(...xs) - pad));
  const ex = Math.min(canvas.width - 1, Math.ceil(Math.max(...xs) + pad));
  const sy = Math.max(0, Math.floor(Math.min(...ys) - pad));
  const ey = Math.min(canvas.height - 1, Math.ceil(Math.max(...ys) + pad));
  const count = closed ? pts.length : pts.length - 1;
  for (let y = sy; y <= ey; y++) {
    for (let x = sx; x <= ex; x++) {
      let minD = Infinity;
      for (let i = 0; i < count; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[(i + 1) % pts.length];
        minD = Math.min(minD, distToSeg(x + 0.5, y + 0.5, ax, ay, bx, by));
      }
      if (minD <= half) blendPixel(canvas, x, y, rgba);
    }
  }
}

export function drawText(canvas, text, x, y, scale, rgba, letterGap = 1) {
  let cursor = x;
  for (const ch of text.toUpperCase()) {
    const rows = FONT_5X7[ch] ?? FONT_5X7[' '];
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 5; c++) {
        if ((rows[r] >> (4 - c)) & 1) {
          fillRect(canvas, cursor + c * scale, y + r * scale, scale, scale, rgba);
        }
      }
    }
    cursor += (5 + letterGap) * scale;
  }
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}

export function encodePng(canvas) {
  const stride = 1 + canvas.width * 4;
  const raw = Buffer.alloc(canvas.height * stride);
  for (let y = 0; y < canvas.height; y++) {
    raw[y * stride] = 0;
    canvas.data.copy(raw, y * stride + 1, y * canvas.width * 4, (y + 1) * canvas.width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(canvas.width, 0);
  ihdr.writeUInt32BE(canvas.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function wrapPngAsIco(pngBuffer, size) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = size >= 256 ? 0 : size;
  header[7] = size >= 256 ? 0 : size;
  header[8] = 0;
  header[9] = 0;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(pngBuffer.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, pngBuffer]);
}
