import { DEPOSIT, ENTITY_KIND, ENTITY_STATE, hexDistance, hexIndex, PREP, TERRAIN } from '@terra/sim';
import { forEachEntity, type ClientTiles, type ClientView } from '../../../store/replica/viewCodec';
import type { HqRespawnBlobRecord } from '../hqRespawnModal';

const MODAL_STYLE_ID = 'ta-hq-respawn-modal-styles';
const MODAL_CSS = `
  /* Backdrop and box: the shared pause scrim (core/ui/scrim.css); only the stacking and the content differ. */
  /* z 9995: above the full-screen weather flash (ScreenWeatherOverlay, 9990), so the dialog stays readable after a meteor. */
  .ta-hq-respawn-backdrop { z-index: 9995; display: none; user-select: none; }
  .ta-hq-respawn-backdrop[data-open="true"] { display: flex; }
  .ta-hq-respawn-card { width: min(520px, 100%); }
  .ta-hq-respawn-inner { display: flex; flex-direction: column; gap: var(--ta-s3); }
  .ta-hq-respawn-desc { margin: 0; font-family: var(--ta-font-body); font-size: var(--ta-fs-small); color: var(--ta-text-2); line-height: 1.5; }
  .ta-hq-respawn-telemetry {
    display: flex; align-items: center; justify-content: space-between; gap: var(--ta-s3);
    padding: var(--ta-s3) var(--ta-s4); background: var(--ta-deep); border: 1px solid var(--ta-seam-2);
    font-family: var(--ta-font-mono); font-size: var(--ta-fs-eyebrow); letter-spacing: var(--ta-track-label); color: var(--ta-energy);
  }
  .ta-hq-respawn-countdown-box {
    display: flex; flex-direction: column; align-items: center; gap: var(--ta-s3);
    padding: var(--ta-s4); background: var(--ta-deep); border: 1px solid var(--ta-seam-3);
  }
  .ta-hq-respawn-timer {
    font-family: var(--ta-font-mono); font-size: 36px; font-weight: 600; line-height: 1;
    letter-spacing: 0.08em; font-variant-numeric: tabular-nums; color: var(--ta-orange-hi);
  }
  .ta-hq-respawn-bar { width: 100%; height: 14px; background: var(--ta-plate-3); border: 1px solid var(--ta-seam-3); overflow: hidden; }
  .ta-hq-respawn-bar-fill { height: 100%; width: 0%; background: var(--ta-orange); transition: width var(--ta-dur-instant) linear; }
  .ta-hq-respawn-footer {
    font-family: var(--ta-font-mono); font-size: var(--ta-fs-label); letter-spacing: var(--ta-track-label);
    text-align: center; color: var(--ta-fault-text); text-transform: uppercase;
  }
`;

export function ensureModalStyles(): void {
  if (typeof document === 'undefined' || !document.head || typeof document.head.appendChild !== 'function') return;
  if (typeof document.getElementById === 'function' && document.getElementById(MODAL_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = MODAL_STYLE_ID;
  style.textContent = MODAL_CSS;
  document.head.appendChild(style);
}

/** Finds the closest terraformed ground tile `(q, r)` on the client view to `(refQ, refR)`. */
export function findClientClosestTerraformedTile(
  view: ClientView,
  tiles: ClientTiles | null | undefined,
  colonyId: number,
  refQ: number,
  refR: number,
): { q: number; r: number } {
  if (!tiles || !tiles.terrain || !tiles.prep) return { q: refQ, r: refR };
  const hx = hexIndex(view.planet.radius);
  const occupied = new Set<number>();
  forEachEntity(view.entities, view.count, (e) => {
    if (e.hp <= 0) return;
    if ((e.kind === ENTITY_KIND.hq || e.kind === ENTITY_KIND.pod) && e.owner === colonyId) return;
    const idx = hx.indexOf(e.q, e.r);
    if (idx >= 0) occupied.add(idx);
  });

  let bestTf: { q: number; r: number; score: number } | null = null;
  let bestFallback: { q: number; r: number; score: number } | null = null;

  for (let idx = 0; idx < tiles.count; idx++) {
    if (occupied.has(idx)) continue;
    const terrain = tiles.terrain[idx];
    const prep = tiles.prep[idx];
    const deposit = tiles.deposit?.[idx] ?? DEPOSIT.none;
    if (
      terrain === TERRAIN.deep ||
      terrain === TERRAIN.shallow ||
      terrain === TERRAIN.hole ||
      terrain === TERRAIN.rock ||
      prep === PREP.ridge ||
      prep === PREP.moat ||
      deposit !== DEPOSIT.none
    ) {
      continue;
    }
    const q = hx.q[idx]!;
    const r = hx.r[idx]!;
    const dist = hexDistance(refQ, refR, q, r);
    const ownerBonus = (tiles.owner?.[idx] ?? -1) === colonyId ? 0.15 : 0;
    const isTf =
      terrain === TERRAIN.flat &&
      (prep === PREP.flat || prep === PREP.prepared || prep === PREP.irrigated || prep === PREP.living);
    if (isTf) {
      const prepBonus = prep >= PREP.prepared && prep <= PREP.living ? 0.05 : 0;
      const score = dist - ownerBonus - prepBonus;
      if (!bestTf || score < bestTf.score) bestTf = { q, r, score };
    } else {
      const score = dist + (terrain === TERRAIN.flat ? 0 : 0.35) - ownerBonus;
      if (!bestFallback || score < bestFallback.score) bestFallback = { q, r, score };
    }
  }
  return bestTf ?? bestFallback ?? { q: refQ, r: refR };
}

export function readHqRespawnRecord(view: ClientView, colonyIndex: number): HqRespawnBlobRecord | undefined {
  const raw = view.blobs?.hqRespawn as Record<string, HqRespawnBlobRecord> | undefined;
  if (!raw || typeof raw !== 'object') return undefined;
  const rec = raw[colonyIndex] ?? raw[String(colonyIndex)];
  return rec && typeof rec === 'object' && typeof rec.q === 'number' ? rec : undefined;
}

export function readHqColonyTracker(
  view: ClientView,
  colonyIndex: number,
): { deployed: boolean; lastQ: number; lastR: number } | undefined {
  const raw = view.blobs?.hqColonyTracker as Record<string, { deployed?: boolean; lastQ?: number; lastR?: number }> | undefined;
  if (!raw || typeof raw !== 'object') return undefined;
  const rec = raw[colonyIndex] ?? raw[String(colonyIndex)];
  if (!rec || typeof rec !== 'object' || !rec.deployed) return undefined;
  return {
    deployed: true,
    lastQ: typeof rec.lastQ === 'number' ? rec.lastQ : 0,
    lastR: typeof rec.lastR === 'number' ? rec.lastR : 0,
  };
}

export function buildHqRespawnModalDom(parentEl: HTMLElement): {
  backdrop: HTMLElement;
  targetEl: HTMLElement;
  timerEl: HTMLElement;
  progressEl: HTMLElement;
} {
  const backdrop = document.createElement('div');
  backdrop.className = 'ta-hq-respawn-backdrop ta-scrim';
  backdrop.setAttribute('data-testid', 'hq-respawn-modal');
  backdrop.setAttribute('data-open', 'false');
  backdrop.setAttribute('role', 'alertdialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.hidden = true;
  backdrop.style.pointerEvents = 'auto';

  const card = document.createElement('div');
  card.className = 'ta-hq-respawn-card ta-scrim__box plate';
  const hazard = document.createElement('div');
  hazard.className = 'ta-hq-respawn-hazard ta-scrim__hazard hazard';
  const inner = document.createElement('div');
  inner.className = 'ta-hq-respawn-inner';

  const badge = document.createElement('div');
  badge.className = 'badge badge-alert';
  badge.setAttribute('data-testid', 'hq-respawn-badge');
  badge.textContent = 'CRITICAL TELEMETRY ALERT // COMMAND UNIT LOST';

  const title = document.createElement('h2');
  title.className = 'ta-hq-respawn-title ta-scrim__title ta-scrim__title--alert';
  title.setAttribute('data-testid', 'hq-respawn-title');
  title.textContent = 'HQ EXPLORER DESTROYED';

  const desc = document.createElement('p');
  desc.className = 'ta-hq-respawn-desc';
  desc.textContent =
    'Colony HQ Explorer Drone was destroyed by planetary hazard activity. Orbital Carrier is preparing an emergency replacement Explorer Pod for immediate atmospheric drop.';

  const telemetry = document.createElement('div');
  telemetry.className = 'ta-hq-respawn-telemetry plate-sm';
  telemetry.setAttribute('data-testid', 'hq-respawn-target');
  telemetry.textContent = 'CLOSEST TERRAFORMED GROUND · HEX (0, 0)';

  const countdownBox = document.createElement('div');
  countdownBox.className = 'ta-hq-respawn-countdown-box plate-sm';
  const countdownLabel = document.createElement('div');
  countdownLabel.className = 'eyebrow';
  countdownLabel.textContent = 'EMERGENCY REPLACEMENT POD LAUNCH COUNTDOWN';
  const timer = document.createElement('div');
  timer.className = 'ta-hq-respawn-timer';
  timer.setAttribute('data-testid', 'hq-respawn-timer');
  timer.textContent = '30.0s';
  const bar = document.createElement('div');
  bar.className = 'ta-hq-respawn-bar plate-sm';
  const fill = document.createElement('div');
  fill.className = 'ta-hq-respawn-bar-fill';
  fill.setAttribute('data-testid', 'hq-respawn-progress');
  fill.style.width = '0%';
  bar.appendChild(fill);
  countdownBox.append(countdownLabel, timer, bar);

  const footer = document.createElement('div');
  footer.className = 'ta-hq-respawn-footer';
  footer.setAttribute('data-testid', 'hq-respawn-footer');
  footer.textContent = 'ORBITAL POD LAUNCH LOCKED — COUNTDOWN CANNOT BE SKIPPED';

  for (const child of [badge, title, desc, telemetry, countdownBox, footer]) inner.appendChild(child);
  for (const child of [hazard, inner]) card.appendChild(child);
  backdrop.appendChild(card);
  parentEl.appendChild(backdrop);
  return { backdrop, targetEl: telemetry, timerEl: timer, progressEl: fill };
}

export function renderHqRespawnTelemetry(
  els: {
    targetEl: HTMLElement | null;
    timerEl: HTMLElement | null;
    progressEl: HTMLElement | null;
  },
  targetTile: { q: number; r: number },
  remainingS: number,
  totalS: number,
): void {
  if (els.targetEl) {
    els.targetEl.textContent = `CLOSEST TERRAFORMED GROUND · HEX (${targetTile.q}, ${targetTile.r})`;
    els.targetEl.setAttribute('data-target-q', String(targetTile.q));
    els.targetEl.setAttribute('data-target-r', String(targetTile.r));
  }
  const clamped = Math.max(0, Math.min(totalS, remainingS));
  const wholeSec = Math.ceil(clamped);
  const mm = String(Math.floor(wholeSec / 60)).padStart(2, '0');
  const ss = String(wholeSec % 60).padStart(2, '0');
  if (els.timerEl) {
    els.timerEl.textContent = `${clamped.toFixed(1)}s (${mm}:${ss})`;
    els.timerEl.setAttribute('data-remaining-s', clamped.toFixed(1));
  }
  if (els.progressEl) {
    const pct = Math.max(0, Math.min(100, ((totalS - clamped) / Math.max(1, totalS)) * 100));
    els.progressEl.style.width = `${pct.toFixed(1)}%`;
  }
}

export function scanColonyHqAndPodState(
  simView: ClientView,
  colonyIndex: number,
  defaultTarget: { q: number; r: number },
): {
  aliveHq: boolean;
  hqPos: { q: number; r: number } | null;
  podDescending: boolean;
  descendingPodId: number | null;
  podQ: number;
  podR: number;
} {
  let aliveHq = false;
  let hqPos: { q: number; r: number } | null = null;
  let podDescending = false;
  let descendingPodId: number | null = null;
  let podQ = defaultTarget.q;
  let podR = defaultTarget.r;

  forEachEntity(simView.entities, simView.count, (e) => {
    if (e.owner !== colonyIndex) return;
    if (e.kind === ENTITY_KIND.hq && e.hp > 0) {
      aliveHq = true;
      hqPos = { q: e.q, r: e.r };
    } else if (e.kind === ENTITY_KIND.pod && e.state === ENTITY_STATE.descending) {
      podDescending = true;
      descendingPodId = e.id;
      podQ = e.q;
      podR = e.r;
    }
  });
  return { aliveHq, hqPos, podDescending, descendingPodId, podQ, podR };
}
