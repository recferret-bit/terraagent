// Pure Node 1024×1024 PNG generator for TerraAgent achievement badges (W12-23).
// Generates valid PNGs with tier-colored hex medallion, pips, and banner via node:zlib.
import { crc32, deflateSync } from 'node:zlib';

const WIDTH = 1024;
const HEIGHT = 1024;
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData) >>> 0, 0);
  return Buffer.concat([len, typeAndData, crc]);
}

function getPalette(tier, isLocked, isStar) {
  let rim = [200, 132, 74]; // Bronze #C8844A
  let rimHi = [240, 184, 136];
  let edge = [80, 36, 8];

  if (isLocked) {
    rim = [138, 147, 162]; // Steel #8A93A2
    rimHi = [170, 178, 192];
    edge = [42, 49, 61]; // Steel dark #2A313D
  } else if (tier === 2) {
    rim = [201, 206, 214]; // Silver #C9CED6
    rimHi = [255, 255, 255];
    edge = [57, 64, 77];
  } else if (tier === 3) {
    rim = [255, 207, 90]; // Gold #FFCF5A
    rimHi = [255, 243, 176];
    edge = [110, 67, 0];
  }

  const starPip = isStar && !isLocked ? [255, 106, 19] : rimHi;
  return Buffer.from([
    7, 8, 10, // 0: Void
    ...rim, // 1: Outer rim
    ...rimHi, // 2: Rim highlight
    ...edge, // 3: Edge / bevel
    17, 19, 24, // 4: Plate
    24, 28, 38, // 5: Inner core
    10, 11, 14, // 6: Banner bg
    ...rim, // 7: Banner border
    ...starPip, // 8: Lit pip / star accent
    45, 51, 64, // 9: Unlit pip
  ]);
}

function renderPixel(x, y, tier, isLocked, isStar) {
  const cyPip = 940;
  if (Math.abs(y - cyPip) <= 16) {
    for (let i = 0; i < 3; i++) {
      const cxPip = 512 + (i - 1) * 72;
      if (Math.hypot(x - cxPip, y - cyPip) <= 16) {
        return i < tier && !isLocked ? 8 : 9;
      }
    }
  }

  if (y >= 800 && y <= 890 && Math.abs(x - 512) <= 410) {
    const isEdge = y <= 806 || y >= 884 || Math.abs(x - 512) >= 404;
    return isEdge ? 7 : 6;
  }

  const dx = Math.abs(x - 512);
  const dy = Math.abs(y - 450);
  const hexDist = Math.max(dx, (dx + 1.7320508 * dy) / 2);

  if (hexDist <= 348) {
    if (hexDist > 330) return 1;
    if (hexDist > 314) return 3;
    if (hexDist > 296) return 2;
    if (hexDist > 160) return 4;
    return 5;
  }

  if (isStar && !isLocked && hexDist <= 366 && hexDist > 356) return 8;
  return 0;
}

export function generateBadgePng(achievement, isLocked = false) {
  const tier = achievement.tier ?? 1;
  const isStar = achievement.star === true;
  const raw = Buffer.alloc(HEIGHT * (1 + WIDTH));
  let offset = 0;

  for (let y = 0; y < HEIGHT; y++) {
    raw[offset++] = 0; // Filter byte 0 (None)
    for (let x = 0; x < WIDTH; x++) {
      raw[offset++] = renderPixel(x, y, tier, isLocked, isStar);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8; // 8 bits per sample
  ihdr[9] = 3; // Indexed color
  ihdr[10] = 0; // Deflate
  ihdr[11] = 0; // Standard filter
  ihdr[12] = 0; // No interlace

  return Buffer.concat([
    PNG_SIG,
    makeChunk('IHDR', ihdr),
    makeChunk('PLTE', getPalette(tier, isLocked, isStar)),
    makeChunk('IDAT', deflateSync(raw)),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}
