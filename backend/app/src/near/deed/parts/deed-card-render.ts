import { crc32, deflateSync } from 'node:zlib';
import {
  DeedMetadataV1,
  deedHexPolygonPoints,
  deedTokenId,
  type DeedHexCoord,
} from '@terra/contracts';

export const DEED_CARD_WIDTH = 1200;
export const DEED_CARD_HEIGHT = 630;

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const DEFAULT_HEX_CLUSTER: readonly DeedHexCoord[] = [
  { q: 0, r: 0 },
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export type DeedVisualVariant = 'active' | 'settled' | 'eliminated';

interface DeedVariantTheme {
  readonly variant: DeedVisualVariant;
  readonly badgeLabel: string;
  readonly voidBg: string;
  readonly plate: string;
  readonly innerPanel: string;
  readonly border: string;
  readonly highlight: string;
  readonly edge: string;
  readonly barFill: string;
  readonly hexFill: string;
  readonly textPrimary: string;
  readonly textMuted: string;
  readonly rgbBorder: readonly [number, number, number];
  readonly rgbHighlight: readonly [number, number, number];
  readonly rgbEdge: readonly [number, number, number];
  readonly rgbBarFill: readonly [number, number, number];
  readonly rgbHexCore: readonly [number, number, number];
}

export function resolveDeedVariant(metadata: DeedMetadataV1): DeedVisualVariant {
  if (metadata.settled || metadata.status === 'settled') {
    return 'settled';
  }
  if (metadata.status === 'eliminated' || metadata.status === 'abandoned') {
    return 'eliminated';
  }
  return 'active';
}

function getVariantTheme(metadata: DeedMetadataV1): DeedVariantTheme {
  const variant = resolveDeedVariant(metadata);
  if (variant === 'settled') {
    return {
      variant,
      badgeLabel: 'SETTLED DEED',
      voidBg: '#07080A',
      plate: '#111318',
      innerPanel: '#181C26',
      border: '#FFCF5A',
      highlight: '#FFF3B0',
      edge: '#6E4300',
      barFill: '#FFCF5A',
      hexFill: '#FFF3B0',
      textPrimary: '#FFF3B0',
      textMuted: '#C9CED6',
      rgbBorder: [255, 207, 90],
      rgbHighlight: [255, 243, 176],
      rgbEdge: [110, 67, 0],
      rgbBarFill: [255, 207, 90],
      rgbHexCore: [255, 224, 130],
    };
  }
  if (variant === 'eliminated') {
    const label = metadata.status === 'abandoned' ? 'ABANDONED' : 'ELIMINATED';
    return {
      variant,
      badgeLabel: label,
      voidBg: '#07080A',
      plate: '#111318',
      innerPanel: '#161920',
      border: '#5A6270',
      highlight: '#8A93A2',
      edge: '#2A313D',
      barFill: '#5A6270',
      hexFill: '#5A6270',
      textPrimary: '#8A93A2',
      textMuted: '#5A6270',
      rgbBorder: [90, 98, 112],
      rgbHighlight: [138, 147, 162],
      rgbEdge: [42, 49, 61],
      rgbBarFill: [90, 98, 112],
      rgbHexCore: [58, 66, 78],
    };
  }
  return {
    variant: 'active',
    badgeLabel: 'ACTIVE DEED',
    voidBg: '#07080A',
    plate: '#111318',
    innerPanel: '#181C26',
    border: '#FF6A13',
    highlight: '#8A93A2',
    edge: '#2A313D',
    barFill: '#FF6A13',
    hexFill: '#30A8DC',
    textPrimary: '#F2F4F8',
    textMuted: '#8A93A2',
    rgbBorder: [255, 106, 19],
    rgbHighlight: [138, 147, 162],
    rgbEdge: [42, 49, 61],
    rgbBarFill: [255, 106, 19],
    rgbHexCore: [48, 168, 220],
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function renderHexTerritorySvg(
  hexes: readonly DeedHexCoord[],
  theme: DeedVariantTheme,
): string {
  const cluster = hexes.length > 0 ? hexes.slice(0, 37) : DEFAULT_HEX_CLUSTER;
  const cx0 = 930;
  const cy0 = 330;
  const hexRadius = cluster.length > 19 ? 22 : 32;
  const spacing = hexRadius * 1.78;
  const sqrt3 = Math.sqrt(3);

  const polys = cluster
    .map((h, idx) => {
      const x = cx0 + spacing * (sqrt3 * h.q + (sqrt3 / 2) * h.r) * 0.55;
      const y = cy0 + spacing * (1.5 * h.r) * 0.55;
      const clampedX = Math.min(1110, Math.max(750, x));
      const clampedY = Math.min(510, Math.max(170, y));
      const isCenter = idx === 0 || (h.q === 0 && h.r === 0);
      const fill = isCenter ? theme.border : theme.innerPanel;
      const stroke = isCenter ? theme.highlight : theme.hexFill;
      return `<polygon points="${deedHexPolygonPoints(clampedX, clampedY, hexRadius - 2)}" fill="${fill}" fill-opacity="${isCenter ? '0.85' : '0.65'}" stroke="${stroke}" stroke-width="2.5"/>`;
    })
    .join('');

  return `<g data-role="hex-territory">
    <polygon points="730,136 1118,136 1136,154 1136,520 1118,538 730,538 712,520 712,154" fill="${theme.voidBg}" stroke="${theme.edge}" stroke-width="2"/>
    <text x="924" y="168" text-anchor="middle" font-family="'IBM Plex Mono',monospace" font-size="14" font-weight="600" fill="${theme.textMuted}" letter-spacing="3">HEX TERRITORY (${cluster.length})</text>
    ${polys}
  </g>`;
}

export function renderDeedCardSvg(
  metadata: DeedMetadataV1,
  opts?: { tokenId?: string; ownerAccountId?: string },
): string {
  const theme = getVariantTheme(metadata);
  const colonyLabel = escapeXml(metadata.colonyName ?? metadata.colony);
  const planetLabel = escapeXml(metadata.planet);
  const planetTypeLabel = metadata.planetType ? ` · ${escapeXml(metadata.planetType.toUpperCase())}` : '';
  const tokenIdLabel = escapeXml(opts?.tokenId ?? deedTokenId(metadata.colony));
  const ownerLabel = opts?.ownerAccountId ? escapeXml(opts.ownerAccountId) : '';
  const stageNum = Math.max(0, Math.min(10, metadata.stage ?? 0));
  const terraformBp = Math.max(0, Math.min(10_000, metadata.terraformBp ?? 0));
  const terraformPct = Math.round(terraformBp / 100);
  const barTrackWidth = 560;
  const barFillWidth = Math.round((terraformBp / 10_000) * barTrackWidth);
  const hexGroup = renderHexTerritorySvg(metadata.territoryHexes ?? DEFAULT_HEX_CLUSTER, theme);

  const extraStats: string[] = [];
  if (metadata.tradeVolume !== undefined) extraStats.push(`TRADE ${metadata.tradeVolume}`);
  if (metadata.truces !== undefined) extraStats.push(`TRUCES ${metadata.truces}`);
  if (metadata.rank !== undefined) extraStats.push(`RANK #${metadata.rank}`);
  if (metadata.walls !== undefined) extraStats.push(`WALLS ${metadata.walls}`);
  const statsLine = extraStats.length > 0 ? escapeXml(extraStats.join(' · ')) : 'NEP-171 DYNAMIC COLONY DEED';

  return `<svg viewBox="0 0 1200 630" width="1200" height="630" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${colonyLabel} — ${theme.badgeLabel}">
  <rect width="1200" height="630" fill="${theme.voidBg}"/>
  <polygon points="44,20 1156,20 1180,44 1180,586 1156,610 44,610 20,586 20,44" fill="${theme.plate}" stroke="${theme.border}" stroke-width="4"/>
  <polygon points="56,32 1144,32 1164,52 1164,578 1144,598 56,598 36,578 36,52" fill="none" stroke="${theme.highlight}" stroke-width="1.5" stroke-opacity="0.65"/>
  <polygon points="64,48 1136,48 1148,60 1148,108 64,108" fill="${theme.innerPanel}" stroke="${theme.edge}" stroke-width="2"/>
  <text x="88" y="85" font-family="'Chakra Petch','IBM Plex Mono',monospace" font-size="22" font-weight="700" fill="${theme.highlight}" letter-spacing="4">TERRAAGENT // COLONY DEED</text>
  <polygon points="820,58 1030,58 1042,70 1042,98 820,98" fill="${theme.border}"/>
  <text x="931" y="84" text-anchor="middle" font-family="'IBM Plex Mono',monospace" font-size="16" font-weight="700" fill="${theme.voidBg}" letter-spacing="2">${theme.badgeLabel}</text>
  <text x="1124" y="84" text-anchor="end" font-family="'IBM Plex Mono',monospace" font-size="18" font-weight="700" fill="${theme.textPrimary}">v${metadata.version}</text>
  <polygon points="72,140 208,140 222,154 222,226 208,240 72,240" fill="${theme.innerPanel}" stroke="${theme.border}" stroke-width="3"/>
  <text x="147" y="172" text-anchor="middle" font-family="'IBM Plex Mono',monospace" font-size="13" font-weight="600" fill="${theme.textMuted}" letter-spacing="2">STAGE RIBBON</text>
  <text x="147" y="218" text-anchor="middle" font-family="'Chakra Petch','IBM Plex Mono',monospace" font-size="42" font-weight="700" fill="${theme.border}">S${stageNum}</text>
  <text x="252" y="182" font-family="'Chakra Petch','IBM Plex Mono',monospace" font-size="40" font-weight="700" fill="${theme.textPrimary}">${colonyLabel}</text>
  <text x="252" y="220" font-family="'IBM Plex Mono',monospace" font-size="18" font-weight="600" fill="${theme.textMuted}">PLANET: ${planetLabel}${planetTypeLabel}</text>
  <text x="72" y="346" font-family="'IBM Plex Mono',monospace" font-size="16" font-weight="600" fill="${theme.textMuted}" letter-spacing="2">TERRAFORM PROGRESS</text>
  <text x="632" y="346" text-anchor="end" font-family="'IBM Plex Mono',monospace" font-size="20" font-weight="700" fill="${theme.border}">${terraformPct}%</text>
  <rect x="72" y="362" width="${barTrackWidth}" height="34" fill="${theme.voidBg}" stroke="${theme.edge}" stroke-width="2"/>
  <rect x="72" y="362" width="${barFillWidth}" height="34" fill="${theme.barFill}"/>
  <text x="72" y="452" font-family="'IBM Plex Mono',monospace" font-size="15" font-weight="600" fill="${theme.highlight}" letter-spacing="1.5">${statsLine}</text>
  <text x="72" y="534" font-family="'IBM Plex Mono',monospace" font-size="14" fill="${theme.textMuted}">TOKEN: ${tokenIdLabel}${ownerLabel ? ` · OWNER: ${ownerLabel}` : ''}</text>
  ${hexGroup}
</svg>`;
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData) >>> 0, 0);
  return Buffer.concat([len, typeAndData, crc]);
}

function buildPngPalette(theme: DeedVariantTheme): Buffer {
  return Buffer.from([
    7, 8, 10, // 0: Void background (#07080A)
    ...theme.rgbBorder, // 1: Variant primary border / ribbon
    ...theme.rgbHighlight, // 2: Variant highlight
    ...theme.rgbEdge, // 3: Variant edge / bevel
    17, 19, 24, // 4: Main Faction Plate (#111318)
    24, 28, 38, // 5: Inner panel (#181C26)
    10, 11, 14, // 6: Track / dark box (#0A0B0E)
    ...theme.rgbBarFill, // 7: Terraform bar fill
    ...theme.rgbHexCore, // 8: Hex territory core fill
    45, 51, 64, // 9: Unlit pip / empty bar (#2D3340)
    201, 206, 214, // 10: Version / signature stripe (#C9CED6)
  ]);
}

function fillRect(
  raw: Buffer,
  stride: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  colorIdx: number,
): void {
  const startX = Math.max(0, Math.min(DEED_CARD_WIDTH, x0));
  const endX = Math.max(startX, Math.min(DEED_CARD_WIDTH, x1));
  const startY = Math.max(0, Math.min(DEED_CARD_HEIGHT, y0));
  const endY = Math.max(startY, Math.min(DEED_CARD_HEIGHT, y1));
  for (let y = startY; y < endY; y++) {
    const rowOffset = y * stride + 1;
    raw.fill(colorIdx, rowOffset + startX, rowOffset + endX);
  }
}

function drawHexStamp(
  raw: Buffer,
  stride: number,
  cx: number,
  cy: number,
  radius: number,
  borderColor: number,
  coreColor: number,
): void {
  const rOuter = Math.max(4, Math.floor(radius));
  const rInner = Math.max(2, rOuter - 3);
  for (let dy = -rOuter; dy <= rOuter; dy++) {
    const y = cy + dy;
    if (y < 24 || y >= DEED_CARD_HEIGHT - 24) continue;
    const absDy = Math.abs(dy);
    const maxDxOuter = Math.floor(Math.min(rOuter, rOuter * 2 - absDy * 1.732));
    if (maxDxOuter <= 0) continue;
    const rowOffset = y * stride + 1;
    const xL = Math.max(24, cx - maxDxOuter);
    const xR = Math.min(DEED_CARD_WIDTH - 24, cx + maxDxOuter);
    raw.fill(borderColor, rowOffset + xL, rowOffset + xR);
    const maxDxInner = Math.floor(Math.min(rInner, rInner * 2 - absDy * 1.732));
    if (maxDxInner > 0) {
      const ixL = Math.max(24, cx - maxDxInner);
      const ixR = Math.min(DEED_CARD_WIDTH - 24, cx + maxDxInner);
      raw.fill(coreColor, rowOffset + ixL, rowOffset + ixR);
    }
  }
}

export function renderDeedCardPng(metadata: DeedMetadataV1): Buffer {
  const theme = getVariantTheme(metadata);
  const stride = 1 + DEED_CARD_WIDTH;
  const raw = Buffer.alloc(DEED_CARD_HEIGHT * stride);

  for (let y = 20; y < DEED_CARD_HEIGHT - 20; y++) {
    const distTop = y - 20;
    const distBot = DEED_CARD_HEIGHT - 21 - y;
    const corner = Math.min(distTop, distBot);
    const chamfer = corner < 24 ? 24 - corner : 0;
    const left = 20 + chamfer;
    const right = DEED_CARD_WIDTH - 20 - chamfer;
    const rowOffset = y * stride + 1;
    raw.fill(1, rowOffset + left, rowOffset + right);
    if (corner >= 4) {
      raw.fill(4, rowOffset + left + 4, rowOffset + right - 4);
    }
  }

  fillRect(raw, stride, 56, 48, 1144, 108, 5);
  fillRect(raw, stride, 820, 56, 1042, 100, 1);

  fillRect(raw, stride, 72, 140, 222, 240, 5);
  fillRect(raw, stride, 72, 140, 222, 146, 1);
  const stage = Math.max(0, Math.min(10, metadata.stage ?? 0));
  for (let i = 0; i < 10; i++) {
    const px = 252 + i * 42;
    fillRect(raw, stride, px, 168, px + 30, 212, i < stage ? 1 : 9);
  }

  const terraformBp = Math.max(0, Math.min(10_000, metadata.terraformBp ?? 0));
  const trackWidth = 560;
  const fillWidth = Math.round((terraformBp / 10_000) * trackWidth);
  fillRect(raw, stride, 72, 358, 72 + trackWidth + 8, 402, 3);
  fillRect(raw, stride, 76, 362, 76 + trackWidth, 398, 9);
  if (fillWidth > 0) {
    fillRect(raw, stride, 76, 362, 76 + fillWidth, 398, 7);
  }

  const version = Math.max(1, metadata.version);
  for (let b = 0; b < 16; b++) {
    const bitSet = ((version + b * 3) & (1 << (b % 5))) !== 0 || b < (version % 16);
    fillRect(raw, stride, 72 + b * 34, 512, 72 + b * 34 + 24, 540, bitSet ? 10 : 6);
  }

  fillRect(raw, stride, 712, 136, 1136, 538, 6);
  const cluster =
    metadata.territoryHexes && metadata.territoryHexes.length > 0
      ? metadata.territoryHexes.slice(0, 19)
      : DEFAULT_HEX_CLUSTER;
  for (let i = 0; i < cluster.length; i++) {
    const h = cluster[i]!;
    const hx = Math.round(924 + (h.q * 48 + h.r * 24));
    const hy = Math.round(336 + h.r * 42);
    drawHexStamp(raw, stride, hx, hy, 22, 2, i === 0 ? 1 : 8);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(DEED_CARD_WIDTH, 0);
  ihdr.writeUInt32BE(DEED_CARD_HEIGHT, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    PNG_SIG,
    makePngChunk('IHDR', ihdr),
    makePngChunk('PLTE', buildPngPalette(theme)),
    makePngChunk('IDAT', deflateSync(raw, { level: 1 })),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}
