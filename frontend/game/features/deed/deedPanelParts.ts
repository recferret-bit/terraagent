import type { DeedView } from '@terra/contracts';
import { buildDeedShareUrl, buildDeedTwitterIntentUrl } from './deedShare';
import { createDeedTracker } from './deedTracker';
import type { FeatureContext } from '../../core/registry/types';

export function defaultFallbackDeed(planetId = 'planet_w20', colonyId = 'col_0'): DeedView {
  const tokenId = `deed:${colonyId}`;
  const encoded = encodeURIComponent(tokenId);
  const now = Date.now();
  const ownerAccountId = `${planetId}-${colonyId}.terraagent.mock`.replace(/[-_]{2,}/g, '-');
  const metadata = {
    planet: planetId,
    colony: colonyId,
    colonyName: 'Aegis Spire',
    planetType: 'temperate' as const,
    stage: 4,
    terraformBp: 4000,
    status: 'active' as const,
    settled: false,
    version: 1,
    imageUrl: `/v1/near/deed/${encoded}/image.png?v=1`,
  };
  return {
    colonyId,
    planetId,
    tokenId,
    ownerAccountId,
    contractId: 'deeds.terraagent.mock',
    metadata,
    version: 1,
    status: 'active',
    settled: false,
    pendingState: 'FINAL',
    pendingRetries: 0,
    accountClaimed: false,
    claimedByAccountId: null,
    txHash: 'mock:deed-mint-v1',
    mintedAt: now,
    updatedAt: now,
    history: [
      {
        version: 1,
        change: 'Deed minted on NEAR',
        at: now,
        txHash: 'mock:deed-mint-v1',
        metadata,
      },
    ],
  };
}

export function buildDeedPanelHeader(onClose: () => void) {
  const headerEl = document.createElement('header');
  headerEl.className = 'ta-deed-panel__header';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'ta-deed-panel__title-group';

  const title = document.createElement('h2');
  title.className = 'ta-deed-panel__title';
  title.textContent = 'COLONY DEED';

  const versionBadge = document.createElement('span');
  versionBadge.className = 'ta-deed-panel__chip';
  versionBadge.dataset.testid = 'deed-version-badge';
  versionBadge.textContent = 'v1';

  const statusChip = document.createElement('span');
  statusChip.className = 'ta-deed-panel__chip';
  statusChip.dataset.testid = 'deed-status-chip';
  statusChip.dataset.status = 'active';
  statusChip.textContent = 'Active';

  const pendingBadge = document.createElement('span');
  pendingBadge.className = 'ta-deed-panel__pending';
  pendingBadge.dataset.testid = 'deed-pending-badge';
  pendingBadge.dataset.pending = 'false';
  pendingBadge.textContent = 'Confirmed';

  titleGroup.appendChild(title);
  titleGroup.appendChild(versionBadge);
  titleGroup.appendChild(statusChip);
  titleGroup.appendChild(pendingBadge);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn btn-sm';
  closeBtn.dataset.testid = 'deed-close-btn';
  closeBtn.textContent = 'CLOSE';
  closeBtn.onclick = onClose;

  headerEl.appendChild(titleGroup);
  headerEl.appendChild(closeBtn);
  return { headerEl, versionBadge, statusChip, pendingBadge };
}

export function buildDeedReceiptAndActions(opts: {
  getCurrentDeed: () => DeedView | null;
  onSettle: () => void;
  ctx: FeatureContext;
  openWindow?: (url: string) => void;
}) {
  const receiptWrap = document.createElement('div');
  receiptWrap.className = 'ta-deed-panel__receipt-row';

  const receiptLink = document.createElement('a');
  receiptLink.className = 'ta-deed-panel__receipt-link';
  receiptLink.dataset.testid = 'deed-receipt-link';
  receiptLink.target = '_blank';
  receiptLink.rel = 'noopener noreferrer';
  receiptLink.href = '/dev/chain/?tab=deeds';
  receiptLink.textContent = 'Recorded on NEAR (mock)';

  const shareLink = document.createElement('a');
  shareLink.className = 'ta-deed-panel__receipt-link';
  shareLink.dataset.testid = 'deed-share-link';
  shareLink.target = '_blank';
  shareLink.rel = 'noopener noreferrer';
  shareLink.href = '/deed/deed%3Acol_0';
  shareLink.textContent = '/deed/deed:col_0';

  receiptWrap.appendChild(receiptLink);
  receiptWrap.appendChild(shareLink);

  const actionsWrap = document.createElement('div');
  actionsWrap.className = 'ta-deed-panel__actions';

  const settleBtn = document.createElement('button');
  settleBtn.type = 'button';
  settleBtn.className = 'btn btn-sm btn-primary';
  settleBtn.dataset.testid = 'deed-settle-btn';
  settleBtn.textContent = 'Seal Settled Deed';
  settleBtn.onclick = opts.onSettle;

  const shareXBtn = document.createElement('button');
  shareXBtn.type = 'button';
  shareXBtn.className = 'btn btn-sm';
  shareXBtn.dataset.testid = 'deed-share-x-btn';
  shareXBtn.textContent = 'Share on X';
  shareXBtn.onclick = () => {
    const deed = opts.getCurrentDeed();
    if (!deed) return;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const intentUrl = buildDeedTwitterIntentUrl({
      tokenId: deed.tokenId,
      colonyName: deed.metadata.colonyName ?? deed.colonyId,
      planetId: deed.planetId,
      stage: deed.metadata.stage ?? 4,
      terraformBp: deed.metadata.terraformBp ?? 0,
      settled: deed.settled,
      origin,
    });
    shareXBtn.dataset.lastIntentUrl = intentUrl;
    shareLink.href = buildDeedShareUrl(deed.tokenId, origin);
    createDeedTracker(opts.ctx.services.track).deedShared({
      colonyId: deed.colonyId,
      planetId: deed.planetId,
      tokenId: deed.tokenId,
      channel: 'x',
    });
    if (opts.openWindow) {
      opts.openWindow(intentUrl);
    } else if (typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open(intentUrl, '_blank', 'noopener,noreferrer');
    }
  };

  actionsWrap.appendChild(settleBtn);
  actionsWrap.appendChild(shareXBtn);
  return { receiptWrap, actionsWrap, receiptLink, shareLink, settleBtn, shareXBtn };
}

export function buildDeedHistorySection() {
  const section = document.createElement('div');
  section.className = 'ta-deed-panel__history';

  const heading = document.createElement('span');
  heading.className = 'label';
  heading.textContent = 'METADATA HISTORY';

  const list = document.createElement('ul');
  list.className = 'ta-deed-panel__history-list';
  list.dataset.testid = 'deed-history-list';

  section.appendChild(heading);
  section.appendChild(list);
  return { section, list };
}

export function renderDeedStatsGrid(statsGridEl: HTMLElement, deed: DeedView): void {
  while (statsGridEl.firstChild) {
    statsGridEl.removeChild(statsGridEl.firstChild);
  }
  const tfPct = `${Math.round((deed.metadata.terraformBp ?? 0) / 100)} %`;
  const rows: Array<[string, string, string]> = [
    ['Colony', deed.metadata.colonyName ?? deed.colonyId, 'deed-stat-colony'],
    ['Planet', deed.planetId, 'deed-stat-planet'],
    ['Stage', `Stage ${deed.metadata.stage ?? 0}`, 'deed-stat-stage'],
    ['Terraform', tfPct, 'deed-stat-terraform'],
    ['Owner Account', deed.claimedByAccountId ?? deed.ownerAccountId, 'deed-stat-account'],
    ['Token ID', deed.tokenId, 'deed-stat-token'],
  ];
  for (const [label, value, testid] of rows) {
    const cell = document.createElement('div');
    cell.className = 'ta-deed-panel__stat';
    const l = document.createElement('span');
    l.className = 'ta-deed-panel__stat-label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'ta-deed-panel__stat-value';
    v.dataset.testid = testid;
    v.textContent = value;
    cell.appendChild(l);
    cell.appendChild(v);
    statsGridEl.appendChild(cell);
  }
}

export function renderDeedHistoryList(historyListEl: HTMLUListElement, deed: DeedView): void {
  while (historyListEl.firstChild) {
    historyListEl.removeChild(historyListEl.firstChild);
  }
  const items =
    deed.history.length > 0
      ? [...deed.history].sort((a, b) => b.version - a.version)
      : [
          {
            version: deed.version,
            change: 'Deed minted on NEAR',
            at: Date.now(),
            txHash: deed.txHash,
            metadata: deed.metadata,
          },
        ];
  for (const entry of items) {
    const li = document.createElement('li');
    li.className = 'ta-deed-panel__history-item';
    li.dataset.version = String(entry.version);

    const left = document.createElement('span');
    left.textContent = `v${entry.version} · ${entry.change}`;

    const right = document.createElement('span');
    const rawAt = entry.at as number | string | undefined;
    const iso =
      typeof rawAt === 'number'
        ? new Date(rawAt).toISOString()
        : typeof rawAt === 'string'
          ? rawAt
          : '';
    const shortDate = iso ? iso.slice(0, 19).replace('T', ' ') : '';
    right.textContent = entry.txHash ? `${shortDate} (${entry.txHash})` : shortDate;

    li.appendChild(left);
    li.appendChild(right);
    historyListEl.appendChild(li);
  }
}
