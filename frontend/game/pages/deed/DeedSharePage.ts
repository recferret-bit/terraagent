import type { PublicDeedResponse } from '@terra/contracts';
import { createDeedCardArtElement } from '../../features/deed/deedCardArt';
import {
  buildDeedImageUrl,
  buildDeedShareUrl,
  buildDeedTwitterIntentUrl,
  extractDeedTokenIdFromLocation,
} from '../../features/deed/deedShare';

export type DeedFetchFn = (
  input: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface MountDeedSharePageOptions {
  readonly tokenId?: string;
  readonly fetch?: DeedFetchFn;
  readonly origin?: string;
}

function setMetaContent(selector: string, content: string): void {
  if (typeof document === 'undefined') return;
  const el = document.head?.querySelector(selector);
  if (el) el.setAttribute('content', content);
}

function updateDocumentOpenGraphMeta(
  deed: PublicDeedResponse,
  origin?: string,
): void {
  if (typeof document === 'undefined') return;
  const meta = deed.metadata;
  const colonyName = meta.colonyName ?? meta.colony;
  const stage = Math.max(0, Math.min(10, Math.trunc(meta.stage ?? 0)));
  const pct = Math.round(
    Math.max(0, Math.min(10_000, Math.trunc(meta.terraformBp ?? 0))) / 100,
  );
  const settled = Boolean(deed.settled || meta.settled);
  const statusUpper = (deed.status || meta.status).toUpperCase();
  const title = `${colonyName} — Stage S${stage} Colony Deed | TerraAgent`;
  const desc = `Terraform ${pct}% · Status: ${statusUpper}${settled ? ' (Settled)' : ''} · Planet ${deed.planetId} · Token ${deed.tokenId} on NEAR`;
  const imgUrl = buildDeedImageUrl(deed.tokenId, deed.version, origin);
  const pageUrl = buildDeedShareUrl(deed.tokenId, origin);

  document.title = title;
  setMetaContent('meta[name="description"]', desc);
  setMetaContent('meta[property="og:title"]', title);
  setMetaContent('meta[property="og:description"]', desc);
  setMetaContent('meta[property="og:image"]', imgUrl);
  setMetaContent('meta[property="og:url"]', pageUrl);
  setMetaContent('meta[name="twitter:title"]', title);
  setMetaContent('meta[name="twitter:description"]', desc);
  setMetaContent('meta[name="twitter:image"]', imgUrl);
}

function buildTopbar(): HTMLElement {
  const header = document.createElement('header');
  header.className = 'ta-deed-share-topbar';
  header.setAttribute('data-testid', 'deed-share-header');

  const inner = document.createElement('div');
  inner.className = 'ta-deed-share-topbar-inner';

  const brand = document.createElement('a');
  brand.className = 'ta-deed-share-brand';
  brand.href = '/';
  brand.textContent = 'TERRAAGENT // COLONY DEED';

  const cta = document.createElement('a');
  cta.className = 'btn btn-primary btn-sm';
  cta.href = '/play.html';
  cta.textContent = 'Colonize on TerraAgent';

  inner.append(brand, cta);
  header.appendChild(inner);
  return header;
}

function buildMetaGrid(deed: PublicDeedResponse): HTMLElement {
  const meta = deed.metadata;
  const colonyName = meta.colonyName ?? meta.colony;
  const stage = Math.max(0, Math.min(10, Math.trunc(meta.stage ?? 0)));
  const pct = Math.round(
    Math.max(0, Math.min(10_000, Math.trunc(meta.terraformBp ?? 0))) / 100,
  );
  const items: readonly [string, string][] = [
    ['COLONY', colonyName],
    ['PLANET', deed.planetId],
    ['STAGE', `S${stage}`],
    ['TERRAFORM', `${pct}%`],
    ['TOKEN ID', deed.tokenId],
    ['OWNER ACCOUNT', deed.ownerAccountId],
    ['CONTRACT', deed.contractId],
  ];

  const dl = document.createElement('dl');
  dl.className = 'ta-deed-share-meta-grid';
  dl.setAttribute('data-testid', 'deed-share-stats');

  for (const [label, value] of items) {
    const wrap = document.createElement('div');
    wrap.className = 'ta-deed-share-meta-item';
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    wrap.append(dt, dd);
    dl.appendChild(wrap);
  }
  return dl;
}

function buildHistorySection(deed: PublicDeedResponse): HTMLElement {
  const section = document.createElement('section');
  section.className = 'ta-deed-share-history';
  section.setAttribute('data-testid', 'deed-share-history');

  const h2 = document.createElement('h2');
  h2.className = 'h3';
  h2.textContent = 'Metadata History';

  const list = document.createElement('ul');
  list.className = 'ta-deed-share-history-list';

  const entries =
    deed.history.length > 0
      ? deed.history
      : [
          {
            version: deed.version,
            at: deed.updatedAt,
            change: 'Colony Deed minted',
            metadata: deed.metadata,
          },
        ];

  for (const entry of entries) {
    const li = document.createElement('li');
    li.className = 'ta-deed-share-history-row';

    const left = document.createElement('span');
    left.textContent = `v${entry.version} — ${entry.change}`;

    const right = document.createElement('span');
    right.className = 'muted';
    right.textContent = entry.txHash ?? 'Recorded on NEAR (mock)';

    li.append(left, right);
    list.appendChild(li);
  }

  section.append(h2, list);
  return section;
}

export class DeedSharePage {
  constructor(
    private readonly root: HTMLElement,
    private readonly opts: MountDeedSharePageOptions = {},
  ) {
    this.root.classList.add('ta-deed-share-root');
    this.root.dataset.page = 'deed-share';
  }

  async load(): Promise<void> {
    const tokenId =
      this.opts.tokenId ??
      this.root.getAttribute('data-token-id') ??
      extractDeedTokenIdFromLocation() ??
      'deed:col_0';

    const fetchFn: DeedFetchFn =
      this.opts.fetch ?? ((input, init) => fetch(input, init));

    try {
      const res = await fetchFn(`/v1/deeds/${encodeURIComponent(tokenId)}`);
      if (!res.ok) {
        this.renderError(
          res.status === 404
            ? `Colony Deed "${tokenId}" was not found.`
            : `Unable to load Colony Deed (${res.status}).`,
        );
        return;
      }
      const deed = (await res.json()) as PublicDeedResponse;
      this.renderDeed(deed);
    } catch {
      this.renderError('Network error while loading Colony Deed.');
    }
  }

  renderDeed(deed: PublicDeedResponse): void {
    const origin =
      this.opts.origin ??
      (typeof window !== 'undefined' ? window.location.origin : undefined);
    updateDocumentOpenGraphMeta(deed, origin);

    this.root.replaceChildren();
    this.root.appendChild(buildTopbar());

    const main = document.createElement('main');
    main.className = 'ta-deed-share-main';
    main.setAttribute('data-testid', 'deed-share-page');

    const hero = document.createElement('section');
    hero.className = 'ta-deed-share-hero';
    hero.setAttribute('data-testid', 'deed-share-card');

    const cardArt = createDeedCardArtElement(deed.metadata, {
      tokenId: deed.tokenId,
      ownerAccountId: deed.ownerAccountId,
    });

    const img = document.createElement('img');
    img.className = 'ta-deed-share-preview-img';
    img.src = buildDeedImageUrl(deed.tokenId, deed.version);
    img.width = 1200;
    img.height = 630;
    img.alt = `${deed.metadata.colonyName ?? deed.metadata.colony} Colony Deed`;
    img.setAttribute('data-testid', 'deed-share-image');

    const actions = document.createElement('div');
    actions.className = 'ta-deed-share-actions';
    actions.setAttribute('data-testid', 'deed-share-actions');

    const colonizeBtn = document.createElement('a');
    colonizeBtn.className = 'btn btn-primary';
    colonizeBtn.href = '/play.html';
    colonizeBtn.setAttribute('data-testid', 'deed-colonize-cta');
    colonizeBtn.textContent = 'Colonize on TerraAgent';

    const shareXBtn = document.createElement('a');
    shareXBtn.className = 'btn btn-ghost';
    shareXBtn.href = buildDeedTwitterIntentUrl({
      tokenId: deed.tokenId,
      colonyName: deed.metadata.colonyName ?? deed.metadata.colony,
      planetId: deed.planetId,
      stage: deed.metadata.stage,
      terraformBp: deed.metadata.terraformBp,
      settled: deed.settled || deed.metadata.settled,
      origin,
    });
    shareXBtn.target = '_blank';
    shareXBtn.rel = 'noopener noreferrer';
    shareXBtn.setAttribute('data-testid', 'deed-share-x-btn');
    shareXBtn.textContent = 'Share on X';

    actions.append(colonizeBtn, shareXBtn);
    hero.append(cardArt, img, buildMetaGrid(deed), actions);
    main.append(hero, buildHistorySection(deed));
    this.root.appendChild(main);
  }

  renderError(message: string): void {
    this.root.replaceChildren();
    this.root.appendChild(buildTopbar());

    const main = document.createElement('main');
    main.className = 'ta-deed-share-main';

    const box = document.createElement('section');
    box.className = 'plate ta-deed-share-status';
    box.setAttribute('data-testid', 'deed-share-error');

    const h1 = document.createElement('h1');
    h1.className = 'h3';
    h1.textContent = 'Colony Deed Unavailable';

    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = message;

    const cta = document.createElement('a');
    cta.className = 'btn btn-primary btn-sm';
    cta.href = '/play.html';
    cta.setAttribute('data-testid', 'deed-colonize-cta');
    cta.textContent = 'Colonize on TerraAgent';

    box.append(h1, p, cta);
    main.appendChild(box);
    this.root.appendChild(main);
  }
}

export function mountDeedSharePage(
  root: HTMLElement,
  opts: MountDeedSharePageOptions = {},
): DeedSharePage {
  const page = new DeedSharePage(root, opts);
  void page.load();
  return page;
}
