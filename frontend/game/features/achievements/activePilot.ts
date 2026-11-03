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
  private isW12Scenario = false;
  private lockedPilot = false;
  private seededW12For = '';
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
    this.maybeSeedW12();
  }

  private syncFromSearch(): void {
    try {
      const search = typeof location !== 'undefined' ? location.search : '';
      const params = new URLSearchParams(search);
      const scenario = params.get('scenario')?.trim().toLowerCase();
      if (scenario?.startsWith('w12')) {
        this.isW12Scenario = true;
      }
      const as = params.get('as')?.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
      const devHandle = as || (this.isW12Scenario ? 'w12' : '');
      if (devHandle) {
        this.playerId = `pr_dev_${devHandle}`;
        this.accessToken = `dev:${devHandle}`;
        this.lockedPilot = true;
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
      if (this.lockedPilot) return;
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
        if (!this.lockedPilot) {
          this.playerId = msg.d.playerId;
          const pilotTok = this.ctx.services.pilot?.view().accessToken ?? '';
          if (pilotTok) {
            this.accessToken = pilotTok;
          } else if (this.playerId.startsWith('pr_dev_')) {
            this.accessToken = `dev:${this.playerId.slice('pr_dev_'.length)}`;
          } else {
            this.accessToken = `player:${this.playerId}`;
          }
          this.persist();
        }
        this.maybeSeedW12();
      }
    });
    this.cleanups.push(off);
  }

  private maybeSeedW12(): void {
    if (!this.isW12Scenario || !this.playerId || this.seededW12For === this.playerId) return;
    const server = this.ctx.services.devServer;
    if (!server) return;
    this.seededW12For = this.playerId;
    void server('profile.seed_w12', { playerId: this.playerId }).catch(() => undefined);
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
