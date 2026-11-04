import type { ResourceKey } from '@terra/contracts';
import { viewColony } from '../shared/colony';
import {
  formatCargoCount,
  ORBIT_FAMILY_GROUPS,
  SUB_RESOURCE_LABELS,
  type ResolvedTradeHubCargoView,
} from './cargoView';

/**
 * Player-facing error messages for every W10-01 error code.
 * (matching docs/plan/waves/W10-cargo-trade-hub.md §4).
 */
export const CARGO_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  no_trade_hub: 'Build a Trade Hub to move cargo to orbit.',
  hub_offline: 'Trade Hub is unpowered.',
  insufficient_stock: 'Not enough in colony storage.',
  insufficient_cargo: 'Not enough in orbit.',
  storage_full: 'Storage is full — build a Supply Depot or free space.',
  mint_cap: 'Hub throughput or daily mint limit reached.',
};

/**
 * Parses retry delay in seconds from a detail string (e.g. `retryInS=42`, `retry in 42s`, `in 34 s`).
 */
export function parseRetryInSeconds(detail?: string): number | null {
  if (!detail || typeof detail !== 'string') return null;
  const eqMatch = detail.match(/retryInS=(\d+)/i);
  if (eqMatch) return Number(eqMatch[1]);
  const inMatch = detail.match(/(?:retry\s+)?in\s+(\d+)\s*s/i);
  if (inMatch) return Number(inMatch[1]);
  const nextMatch = detail.match(/next\s+slot\s+in\s+(\d+)\s*s/i);
  if (nextMatch) return Number(nextMatch[1]);
  return null;
}

/**
 * Formats a player-facing cargo error toast.
 * For `mint_cap`, incorporates the countdown `retry in ${retryInS}s`.
 */
export function formatCargoErrorToast(
  code: string,
  detail?: string,
  retryInS?: number | null,
): string {
  if (code === 'mint_cap') {
    const effectiveRetry =
      retryInS !== undefined && retryInS !== null ? retryInS : parseRetryInSeconds(detail);
    if (detail) {
      const stripped = detail
        .replace(/(?:—\s*)?(?:[Rr]etry\s+in\s+\d+\s*s\.?|\(?retryInS=\d+\)?|[Nn]ext\s+slot\s+in\s+\d+\s*s\.?)/gi, '')
        .trim()
        .replace(/[—\-.,:;]+$/, '')
        .trim();
      const base = stripped.length > 0 ? stripped : CARGO_ERROR_MESSAGES.mint_cap.replace(/\.$/, '');
      if (effectiveRetry !== null && effectiveRetry !== undefined) {
        return `${base} — retry in ${effectiveRetry}s`;
      }
      return detail;
    }
    if (effectiveRetry !== null && effectiveRetry !== undefined) {
      const base = CARGO_ERROR_MESSAGES.mint_cap.replace(/\.$/, '');
      return `${base} — retry in ${effectiveRetry}s`;
    }
    return CARGO_ERROR_MESSAGES.mint_cap;
  }
  return CARGO_ERROR_MESSAGES[code] ?? detail ?? code;
}

/**
 * Formats a refund toast when an export or import transfer fails (Demo Story Step 8).
 */
export function formatCargoRefundToast(
  amount: number,
  resource: ResourceKey,
  direction: 'export' | 'import' = 'export',
): string {
  const countStr = formatCargoCount(amount);
  const label = SUB_RESOURCE_LABELS[resource] ?? resource;
  if (direction === 'export') {
    return `Orbit transfer failed — ${countStr} ${label} returned to stock`;
  }
  return `Colony import failed — ${countStr} ${label} remains in orbit`;
}

export interface PendingTransferItem {
  readonly ref: string;
  readonly direction: 'export' | 'import';
  readonly resource: ResourceKey;
  readonly amount: number;
}

export interface ExtractedPendingTransfers {
  readonly exports: readonly PendingTransferItem[];
  readonly imports: readonly PendingTransferItem[];
  readonly all: readonly PendingTransferItem[];
  readonly totalPendingExportsAmount: number;
  readonly totalPendingImportsAmount: number;
}

/**
 * Extracts active pending exports and imports from both `resolved.pending` and sim state (`view.colonies[colonyIndex].cargo`).
 */
export function extractPendingTransfers(
  resolved: ResolvedTradeHubCargoView,
  view?: unknown,
  colonyIndex?: number,
): ExtractedPendingTransfers {
  const itemsByRef = new Map<string, PendingTransferItem>();
  const colIdx = colonyIndex ?? resolved.colonyIndex ?? 0;

  for (const p of resolved.pending ?? []) {
    if (p && p.ref && p.amount > 0 && p.state !== 'FINAL' && p.state !== 'FAILED') {
      const direction: 'export' | 'import' =
        p.direction ?? p.dir ?? (p.ref.includes('import') ? 'import' : 'export');
      itemsByRef.set(p.ref, {
        ref: p.ref,
        direction,
        resource: p.resource,
        amount: p.amount,
      });
    }
  }

  if (view && typeof view === 'object') {
    const rawView = view as Record<string, unknown>;
    const col = (viewColony(rawView, colIdx) ?? rawView.colony) as Record<string, unknown> | undefined;
    const colCargo = (col?.cargo ?? rawView.cargo) as Record<string, unknown> | undefined;

    const mintEntries = colCargo?.pendingMint;
    if (mintEntries && typeof mintEntries === 'object') {
      const list = Array.isArray(mintEntries) ? mintEntries : Object.values(mintEntries);
      for (const m of list) {
        if (m && typeof m === 'object' && m.ref && typeof m.amount === 'number' && m.amount > 0 && m.resource) {
          if (!itemsByRef.has(m.ref)) {
            itemsByRef.set(m.ref, {
              ref: m.ref,
              direction: 'export',
              resource: m.resource as ResourceKey,
              amount: m.amount,
            });
          }
        }
      }
    }

    const importEntries = colCargo?.pendingImport;
    if (importEntries && typeof importEntries === 'object') {
      const list = Array.isArray(importEntries) ? importEntries : Object.values(importEntries);
      for (const m of list) {
        if (m && typeof m === 'object' && m.ref && typeof m.amount === 'number' && m.amount > 0 && m.resource) {
          if (!itemsByRef.has(m.ref)) {
            itemsByRef.set(m.ref, {
              ref: m.ref,
              direction: 'import',
              resource: m.resource as ResourceKey,
              amount: m.amount,
            });
          }
        }
      }
    }
  }

  const all = Array.from(itemsByRef.values());
  const exports = all.filter((i) => i.direction === 'export');
  const imports = all.filter((i) => i.direction === 'import');
  const totalPendingExportsAmount = exports.reduce((acc, i) => acc + i.amount, 0);
  const totalPendingImportsAmount = imports.reduce((acc, i) => acc + i.amount, 0);

  return { exports, imports, all, totalPendingExportsAmount, totalPendingImportsAmount };
}

export function formatPendingExportChipText(exports: readonly PendingTransferItem[]): string {
  if (exports.length === 0) return '';
  if (exports.length === 1) {
    const item = exports[0];
    const label = SUB_RESOURCE_LABELS[item.resource] ?? item.resource;
    return `Loading cargo… (${formatCargoCount(item.amount)} ${label})`;
  }
  const total = exports.reduce((sum, x) => sum + x.amount, 0);
  const firstRes = exports[0].resource;
  const sameRes = exports.every((x) => x.resource === firstRes);
  if (sameRes) {
    const label = SUB_RESOURCE_LABELS[firstRes] ?? firstRes;
    return `Loading cargo… (${formatCargoCount(total)} ${label})`;
  }
  return `Loading cargo… (${formatCargoCount(total)} units)`;
}

export function formatPendingImportChipText(imports: readonly PendingTransferItem[]): string {
  if (imports.length === 0) return '';
  if (imports.length === 1) {
    const item = imports[0];
    const label = SUB_RESOURCE_LABELS[item.resource] ?? item.resource;
    return `Unloading… (${formatCargoCount(item.amount)} ${label})`;
  }
  const total = imports.reduce((sum, x) => sum + x.amount, 0);
  const firstRes = imports[0].resource;
  const sameRes = imports.every((x) => x.resource === firstRes);
  if (sameRes) {
    const label = SUB_RESOURCE_LABELS[firstRes] ?? firstRes;
    return `Unloading… (${formatCargoCount(total)} ${label})`;
  }
  return `Unloading… (${formatCargoCount(total)} units)`;
}

/**
 * Manages toast state, countdowns, and synchronization between panel toast and floating HUD toast.
 */
export class CargoToastController {
  private panelOpen = false;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private autoDismissTimer: ReturnType<typeof setTimeout> | null = null;
  private activeCode: string | null = null;
  private activeDetail: string | undefined = undefined;
  private activeRetryInS: number | null = null;

  constructor(
    private readonly panelToastEl: HTMLElement,
    private readonly floatingToastEl: HTMLElement,
  ) {
    this.panelToastEl.onclick = () => this.dismiss();
    this.floatingToastEl.onclick = () => this.dismiss();
  }

  notifyError(code: string, detail?: string, retryInS?: number | null): void {
    this.clearTimers();
    this.activeCode = code;
    this.activeDetail = detail;
    this.activeRetryInS =
      retryInS !== undefined && retryInS !== null ? retryInS : parseRetryInSeconds(detail);

    this.renderToast(code, detail, this.activeRetryInS);

    this.autoDismissTimer = setTimeout(() => this.dismiss(), 8000);
    if (code === 'mint_cap' && this.activeRetryInS !== null && this.activeRetryInS > 0) {
      let remaining = this.activeRetryInS;
      this.countdownTimer = setInterval(() => {
        remaining -= 1;
        this.activeRetryInS = remaining;
        if (remaining <= 0) {
          if (this.countdownTimer) clearInterval(this.countdownTimer);
          this.countdownTimer = null;
          this.dismiss();
          return;
        }
        this.renderToast('mint_cap', this.activeDetail, this.activeRetryInS);
      }, 1000);
    } else {
      this.autoDismissTimer = setTimeout(() => this.dismiss(), 8000);
    }
  }

  notifyRefund(
    amount: number,
    resource: ResourceKey,
    direction: 'export' | 'import' = 'export',
  ): void {
    this.clearTimers();
    this.activeCode = 'refund';
    this.activeDetail = undefined;
    this.activeRetryInS = null;

    const message = formatCargoRefundToast(amount, resource, direction);
    this.applyToastState('refund', message, null);
    this.autoDismissTimer = setTimeout(() => this.dismiss(), 8000);
  }

  private renderToast(code: string, detail?: string, retryInS?: number | null): void {
    const message = formatCargoErrorToast(code, detail, retryInS);
    this.applyToastState(code, message, retryInS);
  }

  private applyToastState(code: string, message: string, retryInS: number | null | undefined): void {
    for (const el of [this.panelToastEl, this.floatingToastEl]) {
      el.textContent = message;
      el.setAttribute('data-code', code);
      if (retryInS !== null && retryInS !== undefined) {
        el.setAttribute('data-retry-in', String(retryInS));
      } else {
        el.removeAttribute('data-retry-in');
      }
      el.hidden = el === this.panelToastEl ? !this.panelOpen : this.panelOpen;
    }
  }

  setPanelOpen(open: boolean): void {
    this.panelOpen = open;
    this.panelToastEl.hidden = !this.activeCode || !open;
    this.floatingToastEl.hidden = !this.activeCode || open;
  }

  dismiss(): void {
    this.clearTimers();
    this.activeCode = null;
    this.activeDetail = undefined;
    this.activeRetryInS = null;
    for (const el of [this.panelToastEl, this.floatingToastEl]) {
      el.textContent = '';
      el.removeAttribute('data-code');
      el.removeAttribute('data-retry-in');
      el.hidden = true;
    }
  }

  private clearTimers(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    if (this.autoDismissTimer) {
      clearTimeout(this.autoDismissTimer);
      this.autoDismissTimer = null;
    }
  }

  dispose(): void {
    this.dismiss();
    this.floatingToastEl.remove();
  }
}

/**
 * Builds the Orbit Balances UI section with rows for each sub-resource grouped by family.
 */
export function buildOrbitBalancesSection(onSelectResource: (key: ResourceKey) => void): {
  section: HTMLElement;
  orbitRows: Map<ResourceKey, { row: HTMLElement; valEl: HTMLElement }>;
} {
  const section = document.createElement('div');
  section.className = 'ta-trade-hub__orbit-section plate-sm';
  section.setAttribute('data-testid', 'trade-hub-orbit-balances');

  const titleEl = document.createElement('div');
  titleEl.className = 'ta-trade-hub__section-title';
  titleEl.textContent = 'In Orbit';
  section.appendChild(titleEl);

  const orbitRows = new Map<ResourceKey, { row: HTMLElement; valEl: HTMLElement }>();
  const familiesContainer = document.createElement('div');
  familiesContainer.className = 'ta-trade-hub__families';

  for (const group of ORBIT_FAMILY_GROUPS) {
    const familyEl = document.createElement('div');
    familyEl.className = 'ta-trade-hub__family plate-sm';
    familyEl.setAttribute('data-testid', `orbit-family-${group.family}`);
    familyEl.setAttribute('data-family', group.family);

    const hdr = document.createElement('div');
    hdr.className = 'ta-trade-hub__family-header';
    hdr.setAttribute('data-testid', `orbit-family-header-${group.family}`);
    hdr.textContent = group.label;
    familyEl.appendChild(hdr);

    for (const sub of group.resources) {
      const row = document.createElement('div');
      row.className = 'ta-trade-hub__orbit-row';
      row.setAttribute('data-testid', `orbit-balance-${sub.key}`);
      row.setAttribute('data-resource', sub.key);
      row.setAttribute('data-family', group.family);
      row.setAttribute('data-balance', '0');
      row.setAttribute('data-empty', 'true');
      row.onclick = () => onSelectResource(sub.key);

      const labelEl = document.createElement('span');
      labelEl.className = 'ta-trade-hub__orbit-label';
      labelEl.setAttribute('data-testid', `orbit-label-${sub.key}`);
      labelEl.textContent = sub.label;

      const valEl = document.createElement('span');
      valEl.className = 'ta-trade-hub__orbit-value';
      valEl.setAttribute('data-testid', `orbit-value-${sub.key}`);
      valEl.textContent = '0';

      row.append(labelEl, valEl);
      familyEl.appendChild(row);
      orbitRows.set(sub.key, { row, valEl });
    }
    familiesContainer.appendChild(familyEl);
  }

  section.appendChild(familiesContainer);
  return { section, orbitRows };
}
