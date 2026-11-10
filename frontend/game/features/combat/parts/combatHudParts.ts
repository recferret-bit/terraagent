import { TILE_M } from '@terra/render/planets/hex';
import { axialToPlane, hexDistance } from '@terra/sim/grid/hex';
import type { FeatureContext } from '../../../core/registry/types';
import { makeDiv, makeSpan } from '../../shared/dom';
import type { CombatEventInput, CombatLogEntry, CombatLogEventKind } from '../CombatAlertsHud';
import type { CombatAlertPing, ScreenEdge } from '../threatsLayer';

export const ALERT_PING_DURATION_MS = 5000;
export const OFF_SCREEN_TILE_RADIUS = 8;
export const MAX_COMBAT_LOG_ENTRIES = 12;

export const COMBAT_LOG_KINDS: ReadonlySet<string> = new Set<CombatLogEventKind>([
  'underAttack',
  'raidStarted',
  'raidRepelled',
  'buildingDestroyed',
  'unitDestroyed',
  'nestDestroyed',
]);

export function resolveScreenEdge(focusQ: number, focusR: number, targetQ: number, targetR: number): ScreenEdge | null {
  const dist = hexDistance(Math.round(focusQ), Math.round(focusR), Math.round(targetQ), Math.round(targetR));
  if (dist <= OFF_SCREEN_TILE_RADIUS) return null;
  const dq = targetQ - focusQ;
  const dr = targetR - focusR;
  const [dx, dy] = axialToPlane(dq, dr);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy >= 0 ? 'bottom' : 'top';
}

export function formatCombatLogLabel(kind: CombatLogEventKind, data: Record<string, unknown>): string {
  if (kind === 'underAttack') return 'Colony under attack';
  if (kind === 'raidStarted') {
    const species = typeof data.species === 'string' && data.species ? ` (${data.species})` : '';
    return `Raid incoming${species}`;
  }
  if (kind === 'raidRepelled') {
    return data.unbreached === true ? 'Raid repelled (Unbreached)' : 'Raid repelled';
  }
  if (kind === 'buildingDestroyed') {
    const bldg = typeof data.building === 'string' && data.building ? `: ${data.building}` : '';
    return `Building lost${bldg}`;
  }
  if (kind === 'unitDestroyed') {
    const unit = typeof data.unit === 'string' && data.unit ? `: ${data.unit}` : '';
    return `Unit destroyed${unit}`;
  }
  return 'Fauna nest destroyed';
}

export function buildCombatHudDom(parent: HTMLElement, ctx: FeatureContext) {
  const el = makeDiv('ta-combat-hud', 'combat-hud');
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Combat alerts and event log');

  const edgeContainerEl = makeDiv('ta-combat-edge-pings', 'combat-edge-pings');
  edgeContainerEl.setAttribute('aria-live', 'assertive');

  const logEl = makeDiv('ta-combat-log plate-sm', 'combat-log');
  logEl.setAttribute('data-combat-log', 'true');
  logEl.setAttribute('data-empty', 'true');
  logEl.setAttribute('aria-live', 'polite');

  const header = makeDiv('ta-combat-log__header');
  header.appendChild(makeSpan('ta-combat-log__title', undefined, 'COMBAT LOG'));
  const logListEl = makeDiv('ta-combat-log__list', 'combat-log-list');
  logEl.append(header, logListEl);

  const emptyEl = makeDiv('ta-combat-empty', 'combat-empty', 'No threats. Raids and attacks on the colony show up here.');
  el.append(emptyEl, logEl);
  parent.appendChild(el);
  // Edge pings are screen-fixed: they live in the HUD overlay so they show while the Combat tab is closed.
  (ctx.services?.hudOverlay ?? el).appendChild(edgeContainerEl);

  return { el, edgeContainerEl, logEl, logListEl, emptyEl };
}

export function computeCameraFocusTile(
  focusOverride: { q: number; r: number } | null,
  ctx: FeatureContext,
): { q: number; r: number } {
  if (focusOverride) return focusOverride;
  const rts = ctx.services.rtsCamera;
  if (rts?.target) {
    const px = rts.target.x / TILE_M;
    const py = rts.target.z / TILE_M;
    const r = (2 * py) / Math.sqrt(3);
    const q = px - r * 0.5;
    if (Number.isFinite(q) && Number.isFinite(r)) return { q, r };
  }
  const cam = ctx.services.camera;
  if (cam?.position && (cam.position.x !== 0 || cam.position.z !== 0) && !rts) {
    const px = cam.position.x / TILE_M;
    const py = cam.position.z / TILE_M;
    const r = (2 * py) / Math.sqrt(3);
    const q = px - r * 0.5;
    if (Number.isFinite(q) && Number.isFinite(r)) return { q, r };
  }
  return { q: 0, r: 0 };
}

export function normalizeCombatEventData(ev: CombatEventInput): Record<string, unknown> {
  const data: Record<string, unknown> = { ...(ev.data ?? {}) };
  if (ev.q !== undefined && data.q === undefined) data.q = ev.q;
  if (ev.r !== undefined && data.r === undefined) data.r = ev.r;
  if (ev.colonyIndex !== undefined && data.colonyIndex === undefined) data.colonyIndex = ev.colonyIndex;
  if (ev.unbreached !== undefined && data.unbreached === undefined) data.unbreached = ev.unbreached;
  return data;
}

export function renderEdgePingButtons(
  edgeContainerEl: HTMLElement,
  pings: readonly CombatAlertPing[],
  onJump: (q: number, r: number) => void,
): void {
  edgeContainerEl.replaceChildren();
  for (const ping of pings) {
    if (!ping.edge) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ta-combat-edge-ping plate-sm';
    btn.setAttribute('data-under-attack-ping', 'true');
    btn.setAttribute('data-testid', 'under-attack-ping');
    btn.setAttribute('data-edge', ping.edge);
    btn.setAttribute('data-q', String(ping.q));
    btn.setAttribute('data-r', String(ping.r));
    const label = ping.kind === 'raidStarted' ? 'RAID INCOMING' : 'UNDER ATTACK';
    btn.textContent = `⚠ ${label} (${ping.q}, ${ping.r})`;
    btn.onclick = () => onJump(ping.q, ping.r);
    edgeContainerEl.appendChild(btn);
  }
}

export function renderCombatLogRows(
  logEl: HTMLElement,
  emptyEl: HTMLElement,
  logListEl: HTMLElement,
  entries: readonly CombatLogEntry[],
  onJump: (q: number, r: number) => void,
): void {
  logListEl.replaceChildren();
  logEl.setAttribute('data-empty', String(entries.length === 0));
  emptyEl.hidden = entries.length > 0;
  for (const item of entries) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'ta-combat-log__entry';
    row.setAttribute('data-combat-log-entry', 'true');
    row.setAttribute('data-event-kind', item.kind);
    if (item.unbreached !== undefined) {
      row.setAttribute('data-unbreached', String(item.unbreached));
    }
    if (item.q !== undefined && item.r !== undefined) {
      row.setAttribute('data-q', String(item.q));
      row.setAttribute('data-r', String(item.r));
      row.onclick = () => onJump(item.q!, item.r!);
    }
    row.textContent =
      item.q !== undefined && item.r !== undefined
        ? `${item.label} [${item.q}, ${item.r}]`
        : item.label;
    logListEl.appendChild(row);
  }
}
