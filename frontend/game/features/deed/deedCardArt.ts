import {
  deedTokenId,
  type DeedHexCoord,
  type DeedMetadataV1,
} from '@terra/contracts';

const SVG_NS = 'http://www.w3.org/2000/svg';

export type DeedVisualVariant = 'active' | 'settled' | 'eliminated' | 'abandoned';

export interface DeedCardArtOptions {
  readonly tokenId?: string;
  readonly ownerAccountId?: string;
}

export interface DeedShowcaseHandle {
  readonly root: HTMLElement;
  readonly cards: HTMLElement[];
}

export const DEFAULT_DEED_HEX_CLUSTER: readonly DeedHexCoord[] = [
  { q: 0, r: 0 },
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export const DEED_SHOWCASE_VARIANTS: readonly {
  readonly metadata: DeedMetadataV1;
  readonly opts: DeedCardArtOptions;
}[] = [
  {
    metadata: {
      planet: 'p-dune-01',
      colony: 'col-aegis',
      colonyName: 'Aegis Basin',
      planetType: 'dune',
      stage: 3,
      terraformBp: 4000,
      tradeVolume: 1280,
      truces: 1,
      rank: 3,
      territoryHexes: DEFAULT_DEED_HEX_CLUSTER.slice(0, 7),
      status: 'active',
      settled: false,
      version: 2,
      imageUrl: '/v1/near/deed/deed:col-aegis/image.png?v=2',
    },
    opts: {
      tokenId: 'deed:col-aegis',
      ownerAccountId: 'col-aegis.Colony.terra.testnet',
    },
  },
  {
    metadata: {
      planet: 'p-ocean-02',
      colony: 'col-helios',
      colonyName: 'Helios Crown',
      planetType: 'oceanForest',
      stage: 4,
      terraformBp: 10_000,
      tradeVolume: 5400,
      truces: 3,
      rank: 1,
      territoryHexes: [
        ...DEFAULT_DEED_HEX_CLUSTER,
        { q: 2, r: -1 },
        { q: 1, r: 1 },
        { q: -1, r: -1 },
        { q: -2, r: 1 },
      ],
      status: 'settled',
      settled: true,
      version: 5,
      imageUrl: '/v1/near/deed/deed:col-helios/image.png?v=5',
    },
    opts: {
      tokenId: 'deed:col-helios',
      ownerAccountId: 'col-helios.Colony.terra.testnet',
    },
  },
  {
    metadata: {
      planet: 'p-rock-03',
      colony: 'col-cinder',
      colonyName: 'Cinder Outpost',
      planetType: 'forestRock',
      stage: 2,
      terraformBp: 2000,
      tradeVolume: 310,
      territoryHexes: DEFAULT_DEED_HEX_CLUSTER.slice(0, 5),
      status: 'eliminated',
      settled: false,
      version: 3,
      imageUrl: '/v1/near/deed/deed:col-cinder/image.png?v=3',
    },
    opts: {
      tokenId: 'deed:col-cinder',
      ownerAccountId: 'col-cinder.Colony.terra.testnet',
    },
  },
];

function createSvgNode<K extends keyof SVGElementTagNameMap>(
  tag: K,
  className?: string,
): SVGElementTagNameMap[K] {
  const el =
    typeof document.createElementNS === 'function'
      ? document.createElementNS(SVG_NS, tag)
      : (document.createElement(tag) as unknown as SVGElementTagNameMap[K]);
  if (className) {
    el.setAttribute('class', className);
    for (const token of className.split(/\s+/).filter(Boolean)) {
      el.classList?.add(token);
    }
  }
  return el;
}

export function resolveDeedVisualVariant(
  meta: Pick<DeedMetadataV1, 'status' | 'settled'>,
): DeedVisualVariant {
  if (meta.settled || meta.status === 'settled') {
    return 'settled';
  }
  if (meta.status === 'abandoned') {
    return 'abandoned';
  }
  if (meta.status === 'eliminated') {
    return 'eliminated';
  }
  return 'active';
}

export function resolveDeedBadgeLabel(variant: DeedVisualVariant): string {
  switch (variant) {
    case 'settled':
      return 'SETTLED DEED';
    case 'eliminated':
      return 'ELIMINATED DEED';
    case 'abandoned':
      return 'ABANDONED DEED';
    case 'active':
    default:
      return 'ACTIVE DEED';
  }
}

export function computeHexPolygonPoints(
  cx: number,
  cy: number,
  radius: number,
): string {
  const points: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angleRad = ((-90 + i * 60) * Math.PI) / 180;
    const x = Math.round((cx + radius * Math.cos(angleRad)) * 10) / 10;
    const y = Math.round((cy + radius * Math.sin(angleRad)) * 10) / 10;
    points.push(`${x},${y}`);
  }
  return points.join(' ');
}

export function createHexTerritorySvg(
  hexes?: readonly DeedHexCoord[],
  variant: DeedVisualVariant = 'active',
): SVGSVGElement {
  const cluster =
    hexes && hexes.length > 0 ? hexes.slice(0, 37) : DEFAULT_DEED_HEX_CLUSTER;
  const svg = createSvgNode('svg', 'ta-deed-card__hex-svg');
  svg.setAttribute('viewBox', '0 0 320 156');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Hex territory (${cluster.length} hexes)`);
  svg.setAttribute('data-variant', variant);
  svg.setAttribute('data-hex-count', String(cluster.length));

  const frame = createSvgNode('polygon', 'ta-deed-card__hex-frame');
  frame.setAttribute('points', '12,4 308,4 316,12 316,144 308,152 12,152 4,144 4,12');
  svg.appendChild(frame);

  const caption = createSvgNode('text', 'ta-deed-card__hex-caption');
  caption.setAttribute('x', '160');
  caption.setAttribute('y', '22');
  caption.setAttribute('text-anchor', 'middle');
  caption.textContent = `HEX TERRITORY (${cluster.length})`;
  svg.appendChild(caption);

  const cx0 = 160;
  const cy0 = 88;
  const radius = cluster.length > 19 ? 11 : 16;
  const spacing = radius * 1.76;
  const sqrt3 = Math.sqrt(3);

  for (let idx = 0; idx < cluster.length; idx++) {
    const hex = cluster[idx]!;
    const rawX = cx0 + spacing * (sqrt3 * hex.q + (sqrt3 / 2) * hex.r) * 0.56;
    const rawY = cy0 + spacing * (1.5 * hex.r) * 0.56;
    const cx = Math.min(292, Math.max(28, rawX));
    const cy = Math.min(136, Math.max(38, rawY));
    const isCenter = idx === 0 || (hex.q === 0 && hex.r === 0);
    const cellClass = isCenter
      ? 'ta-deed-card__hex-cell ta-deed-card__hex-cell--center'
      : 'ta-deed-card__hex-cell';
    const poly = createSvgNode('polygon', cellClass);
    poly.setAttribute('points', computeHexPolygonPoints(cx, cy, radius - 1.5));
    poly.setAttribute('data-q', String(hex.q));
    poly.setAttribute('data-r', String(hex.r));
    svg.appendChild(poly);
  }

  return svg;
}

function buildDeedHeader(
  variant: DeedVisualVariant,
  version: number,
): HTMLElement {
  const header = document.createElement('header');
  header.className = 'ta-deed-card__header';

  const eyebrow = document.createElement('span');
  eyebrow.className = 'ta-deed-card__eyebrow';
  eyebrow.textContent = 'TERRAAGENT // COLONY DEED';

  const metaGroup = document.createElement('div');
  metaGroup.className = 'ta-deed-card__header-meta';

  const badge = document.createElement('span');
  badge.className = 'ta-deed-card__badge';
  badge.setAttribute('data-testid', 'deed-card-badge');
  badge.textContent = resolveDeedBadgeLabel(variant);

  const versionEl = document.createElement('span');
  versionEl.className = 'ta-deed-card__version';
  versionEl.setAttribute('data-testid', 'deed-card-version');
  versionEl.textContent = `v${Math.max(1, Math.trunc(version || 1))}`;

  metaGroup.append(badge, versionEl);
  header.append(eyebrow, metaGroup);
  return header;
}

function buildStageRibbonAndIdentity(metadata: DeedMetadataV1): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ta-deed-card__top-row';

  const stageNum = Math.max(0, Math.min(10, Math.trunc(metadata.stage ?? 0)));
  const ribbon = document.createElement('div');
  ribbon.className = 'ta-deed-card__ribbon';
  ribbon.setAttribute('data-testid', 'deed-card-ribbon');
  ribbon.setAttribute('data-stage', `S${stageNum}`);

  const ribbonLabel = document.createElement('span');
  ribbonLabel.className = 'ta-deed-card__ribbon-label';
  ribbonLabel.textContent = 'STAGE RIBBON';

  const ribbonStage = document.createElement('span');
  ribbonStage.className = 'ta-deed-card__ribbon-stage';
  ribbonStage.textContent = `STAGE S${stageNum}`;

  const pips = document.createElement('div');
  pips.className = 'ta-deed-card__stage-pips';
  for (let i = 0; i < 10; i++) {
    const pip = document.createElement('span');
    pip.className =
      i < stageNum
        ? 'ta-deed-card__stage-pip ta-deed-card__stage-pip--lit'
        : 'ta-deed-card__stage-pip';
    pips.appendChild(pip);
  }
  ribbon.append(ribbonLabel, ribbonStage, pips);

  const identity = document.createElement('div');
  identity.className = 'ta-deed-card__identity';

  const colonyTitle = document.createElement('h3');
  colonyTitle.className = 'ta-deed-card__colony';
  colonyTitle.setAttribute('data-testid', 'deed-card-colony');
  colonyTitle.textContent = metadata.colonyName ?? metadata.colony;

  const planetLine = document.createElement('p');
  planetLine.className = 'ta-deed-card__planet';
  planetLine.setAttribute('data-testid', 'deed-card-planet');
  const planetTypeSuffix = metadata.planetType
    ? ` · ${metadata.planetType.toUpperCase()}`
    : '';
  planetLine.textContent = `PLANET: ${metadata.planet}${planetTypeSuffix}`;

  identity.append(colonyTitle, planetLine);
  row.append(ribbon, identity);
  return row;
}

function buildTerraformBar(terraformBpRaw?: number): HTMLElement {
  const bp = Math.max(0, Math.min(10_000, Math.trunc(terraformBpRaw ?? 0)));
  const pct = Math.round(bp / 100);

  const section = document.createElement('div');
  section.className = 'ta-deed-card__tf';

  const head = document.createElement('div');
  head.className = 'ta-deed-card__tf-header';

  const label = document.createElement('span');
  label.textContent = 'TERRAFORM PROGRESS';

  const pctEl = document.createElement('span');
  pctEl.className = 'ta-deed-card__tf-pct';
  pctEl.setAttribute('data-testid', 'deed-card-tf-pct');
  pctEl.textContent = `${pct}%`;

  head.append(label, pctEl);

  const bar = document.createElement('div');
  bar.className = 'ta-deed-card__tf-bar';
  bar.setAttribute('data-testid', 'deed-card-tf-bar');
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-valuenow', String(pct));

  const fill = document.createElement('div');
  fill.className = 'ta-deed-card__tf-fill';
  fill.setAttribute('data-testid', 'deed-card-tf-fill');
  fill.style.width = `${pct}%`;

  bar.appendChild(fill);
  section.append(head, bar);
  return section;
}

function formatDeedStatsLine(metadata: DeedMetadataV1): string {
  const parts: string[] = [];
  if (metadata.tradeVolume !== undefined) parts.push(`TRADE ${metadata.tradeVolume}`);
  if (metadata.truces !== undefined) parts.push(`TRUCES ${metadata.truces}`);
  if (metadata.rank !== undefined) parts.push(`RANK #${metadata.rank}`);
  if (metadata.walls !== undefined) parts.push(`WALLS ${metadata.walls}`);
  return parts.length > 0 ? parts.join(' · ') : 'NEP-171 DYNAMIC COLONY DEED';
}

export function createDeedCardArtElement(
  metadata: DeedMetadataV1,
  opts?: DeedCardArtOptions,
): HTMLElement {
  const variant = resolveDeedVisualVariant(metadata);
  const tokenId = opts?.tokenId ?? deedTokenId(metadata.colony);

  const card = document.createElement('article');
  const variantClasses =
    variant === 'abandoned'
      ? 'ta-deed-card plate ta-deed-card--abandoned ta-deed-card--eliminated'
      : `ta-deed-card plate ta-deed-card--${variant}`;
  card.className = variantClasses;
  card.setAttribute('data-deed-variant', variant);
  card.setAttribute('data-deed-status', metadata.status);
  card.setAttribute('data-deed-settled', metadata.settled ? 'true' : 'false');
  card.setAttribute('data-token-id', tokenId);
  card.setAttribute('data-testid', `deed-card-${variant}`);

  const header = buildDeedHeader(variant, metadata.version);
  const topRow = buildStageRibbonAndIdentity(metadata);

  const hexWrap = document.createElement('div');
  hexWrap.className = 'ta-deed-card__hex-map';
  hexWrap.setAttribute('data-testid', 'deed-card-hex-map');
  hexWrap.appendChild(createHexTerritorySvg(metadata.territoryHexes, variant));

  const tfSection = buildTerraformBar(metadata.terraformBp);

  const statsEl = document.createElement('div');
  statsEl.className = 'ta-deed-card__stats';
  statsEl.setAttribute('data-testid', 'deed-card-stats');
  statsEl.textContent = formatDeedStatsLine(metadata);

  const footer = document.createElement('footer');
  footer.className = 'ta-deed-card__footer';
  footer.setAttribute('data-testid', 'deed-card-footer');
  const ownerPart = opts?.ownerAccountId ? ` · OWNER: ${opts.ownerAccountId}` : '';
  footer.textContent = `TOKEN: ${tokenId}${ownerPart}`;

  card.append(header, topRow, hexWrap, tfSection, statsEl, footer);
  return card;
}

export function mountDeedCardShowcase(
  container: HTMLElement = document.body,
): DeedShowcaseHandle {
  const pgRoot =
    typeof document !== 'undefined' ? document.getElementById('pg') : null;
  if (pgRoot && container === document.body) {
    pgRoot.style.display = 'none';
  }

  const root = document.createElement('section');
  root.className = 'ta-deed-showcase';
  root.setAttribute('data-testid', 'deed-card-showcase');

  const header = document.createElement('header');
  header.className = 'ta-deed-showcase__header';

  const title = document.createElement('h1');
  title.className = 'ta-deed-showcase__title';
  title.textContent = 'Colony Deed — Faction Plate Variants';

  const subtitle = document.createElement('p');
  subtitle.className = 'ta-deed-showcase__subtitle';
  subtitle.textContent = 'W20-11 // ACTIVE · SETTLED GOLD · ELIMINATED GREY';

  header.append(title, subtitle);

  const grid = document.createElement('div');
  grid.className = 'ta-deed-showcase__grid';
  grid.setAttribute('data-testid', 'deed-card-showcase-grid');

  const cards: HTMLElement[] = [];
  for (const item of DEED_SHOWCASE_VARIANTS) {
    const slot = document.createElement('div');
    slot.className = 'ta-deed-showcase__slot';
    const card = createDeedCardArtElement(item.metadata, item.opts);
    slot.appendChild(card);
    grid.appendChild(slot);
    cards.push(card);
  }

  root.append(header, grid);
  container.appendChild(root);
  return { root, cards };
}
