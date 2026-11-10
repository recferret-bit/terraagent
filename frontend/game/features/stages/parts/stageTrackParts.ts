import { STAGE_TABLE_ROWS, type ViewColony } from '@terra/sim';

/**
 * Formats a dwell countdown in seconds into M:SS representation (e.g. 80 -> "1:20", 5 -> "0:05").
 */
export function formatDwellCountdown(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const total = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/**
 * Extracts remaining dwell seconds from a colony view, supporting
 * `stageDwellRemainingS`, `dwellRemainingS`, or `dwellRemainingTicks` (5 ticks/s).
 */
export function extractDwellRemainingSeconds(col: ViewColony | undefined): number | null {
  if (!col) return null;
  if (typeof col.stageDwellRemainingS === 'number') {
    return col.stageDwellRemainingS;
  }
  if (typeof col.dwellRemainingS === 'number') {
    return col.dwellRemainingS;
  }
  if (typeof col.dwellRemainingTicks === 'number') {
    return Math.max(0, Math.ceil(col.dwellRemainingTicks / 5));
  }
  return null;
}

export function buildStagePanelHeader(opts: {
  root: HTMLElement;
  host: HTMLElement;
  launcher: HTMLButtonElement;
  summaryEl: HTMLParagraphElement;
  onToggle: () => void;
  onClose: () => void;
}): void {
  opts.root.id = 'stage-goals-dialog';
  opts.root.setAttribute('aria-label', 'Stage goals');
  opts.launcher.type = 'button';
  opts.launcher.className = 'ta-stage-launcher btn btn-ghost btn-sm';
  opts.launcher.dataset.testid = 'stage-goals-launcher';
  opts.launcher.setAttribute('aria-controls', opts.root.id);
  opts.launcher.onclick = opts.onToggle;
  const header = document.createElement('div');
  header.className = 'ta-stage-panel-header';
  const title = document.createElement('span');
  title.textContent = 'Goals';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn btn-ghost btn-sm';
  close.textContent = '−';
  close.dataset.testid = 'stage-goals-close';
  close.setAttribute('aria-label', 'Close stage goals');
  close.onclick = opts.onClose;
  header.append(title, close);
  opts.root.append(header);
  opts.summaryEl.className = 'ta-stage-summary';
  opts.host.append(opts.launcher, opts.summaryEl);
}

export function buildStageSegments(
  segmentsContainer: HTMLElement,
  onBrowseStage: (stage: number) => void,
): HTMLElement[] {
  const segmentEls: HTMLElement[] = [];
  for (const row of STAGE_TABLE_ROWS) {
    const n = row.stage;
    const el = document.createElement('button');
    el.type = 'button';
    el.onclick = () => onBrowseStage(n);
    el.className = 'ta-stage-segment';
    el.setAttribute('data-testid', `stage-segment-S${n}`);
    el.setAttribute('data-stage', String(n));
    el.title = `${row.label}: ${row.teaches}`;

    const text = document.createElement('span');
    text.className = 'ta-stage-segment__name';
    text.textContent = row.id;
    el.appendChild(text);

    segmentEls.push(el);
    segmentsContainer.appendChild(el);
  }
  return segmentEls;
}

export function buildStageMetaSection() {
  const meta = document.createElement('div');
  meta.className = 'ta-stage-track__meta';

  const currentBlock = document.createElement('div');
  currentBlock.className = 'ta-stage-track__current';

  const currentLabelEl = document.createElement('div');
  currentLabelEl.className = 'ta-stage-track__label';
  currentLabelEl.setAttribute('data-testid', 'stage-current-label');

  const currentTeachesEl = document.createElement('div');
  currentTeachesEl.className = 'ta-stage-track__teaches';
  currentTeachesEl.setAttribute('data-testid', 'stage-current-teaches');

  currentBlock.append(currentLabelEl, currentTeachesEl);

  const nextBlock = document.createElement('div');
  nextBlock.className = 'ta-stage-track__next';

  const nextConditionEl = document.createElement('div');
  nextConditionEl.className = 'ta-stage-track__next-condition';
  nextConditionEl.setAttribute('data-testid', 'stage-next-condition');

  const dwellCountdownEl = document.createElement('span');
  dwellCountdownEl.className = 'ta-stage-track__dwell';
  dwellCountdownEl.setAttribute('data-testid', 'stage-dwell-countdown');
  dwellCountdownEl.setAttribute('data-active', 'false');
  dwellCountdownEl.textContent = '—';

  nextBlock.append(nextConditionEl, dwellCountdownEl);
  meta.append(currentBlock, nextBlock);
  return { meta, currentLabelEl, currentTeachesEl, nextConditionEl, dwellCountdownEl };
}

export function updateStageSegmentStates(segmentEls: readonly HTMLElement[], stage: number): void {
  for (let n = 0; n < segmentEls.length; n++) {
    const el = segmentEls[n]!;
    el.classList.remove('is-completed', 'is-current', 'is-next', 'is-locked');
    if (n < stage) {
      el.classList.add('is-completed');
      el.setAttribute('data-state', 'completed');
    } else if (n === stage) {
      el.classList.add('is-current');
      el.setAttribute('data-state', 'current');
    } else if (n === stage + 1) {
      el.classList.add('is-next');
      el.setAttribute('data-state', 'pending');
    } else {
      el.classList.add('is-locked');
      el.setAttribute('data-state', 'locked');
    }
  }
}
