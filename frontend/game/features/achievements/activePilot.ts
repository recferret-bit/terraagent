import type { FeatureContext } from '../../core/registry/types';
import type { Transport } from '../../net/types';
import '../../net/services';
import '../identity';

export const ACTIVE_PILOT_STORAGE_KEY = 'ta_active_pilot';

export interface ActivePilotRecord {
  readonly playerId: string;
  readonly accessToken: string;
  readonly updatedAt: number;
}

function saveActivePilot(record: ActivePilotRecord): void {
  try {
    const ls = (globalThis as unknown as { localStorage?: Storage }).localStorage;
    ls?.setItem(ACTIVE_PILOT_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Ignore storage errors in restricted environments
  }
}

export function readActivePilot(): ActivePilotRecord | null {
  try {
    const ls = (globalThis as unknown as { localStorage?: Storage }).localStorage;
    const raw = ls?.getItem(ACTIVE_PILOT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActivePilotRecord>;
    if (typeof parsed.playerId === 'string' && typeof parsed.accessToken === 'string') {
      return {
        playerId: parsed.playerId,
        accessToken: parsed.accessToken,
        updatedAt: Number(parsed.updatedAt ?? 0),
      };
    }
  } catch {
    // Ignore malformed storage
  }
  return null;
}

/**
 * Tracks the online session's active `playerId` (from WS `ready`) and `accessToken` (from `pilot` or `dev:<handle>`)
 * and persists it to `localStorage` so opening `/me.html` in another tab shares the same pilot session.
 */
export class ActivePilotTracker {
  playerId = '';
  accessToken = '';
  private readonly cleanups: Array<() => void> = [];

  constructor(private readonly ctx: FeatureContext) {
    const existing = readActivePilot();
    if (existing) {
      this.playerId = existing.playerId;
      this.accessToken = existing.accessToken;
    }
    this.syncFromSearch();
    this.bindPilot();
    this.bindTransport();
  }

  private syncFromSearch(): void {
    try {
      const search = typeof location !== 'undefined' ? location.search : '';
      const as = new URLSearchParams(search).get('as')?.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (as) {
        this.playerId = `pr_dev_${as}`;
        this.accessToken = `dev:${as}`;
        this.persist();
      }
    } catch {
      // Ignore
    }
  }

  private bindPilot(): void {
    const pilot = this.ctx.services.pilot;
    if (!pilot) return;
    const apply = () => {
      const v = pilot.view();
      if (v.accessToken) {
        this.accessToken = v.accessToken;
        this.persist();
      }
    };
    apply();
    this.cleanups.push(pilot.subscribe(apply));
  }

  private bindTransport(): void {
    const transport = (this.ctx.services as { transport?: Transport }).transport;
    if (!transport || typeof transport.onMessage !== 'function') return;
    const off = transport.onMessage((msg) => {
      if (msg.t === 'ready' && typeof msg.d?.playerId === 'string') {
        this.playerId = msg.d.playerId;
        const pilotTok = this.ctx.services.pilot?.view().accessToken ?? '';
        if (pilotTok) {
          this.accessToken = pilotTok;
        } else if (this.playerId.startsWith('pr_dev_')) {
          this.accessToken = `dev:${this.playerId.slice('pr_dev_'.length)}`;
        }
        this.persist();
      }
    });
    this.cleanups.push(off);
  }

  private persist(): void {
    if (!this.playerId && !this.accessToken) return;
    saveActivePilot({
      playerId: this.playerId,
      accessToken: this.accessToken,
      updatedAt: Date.now(),
    });
  }

  dispose(): void {
    for (const fn of this.cleanups.splice(0)) fn();
  }
}
