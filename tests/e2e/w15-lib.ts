import type { Page } from '@playwright/test';
import { urls } from './harness/ports';

/** Dev seat name. The director-key bearer is `dev:<name>` (non-production). */
export const AS = 'w15';

/** Demo step 5. Partners stay `guild` while W18 is off. */
export const METALS_LIMIT = {
  maxPerTrade: 300,
  maxPerSession: 600,
  minStock: 200,
  partners: 'guild' as const,
  sellAboveStoragePct: 80,
};

/** Accept may fail closed when the NPC has no verifier cargo (LED-40). These codes are stable. */
export const ACCEPT_CODES = new Set([
  'offer_expired',
  'NEAR_INSUFFICIENT_BALANCE',
  'insufficient_resources',
  'market_unavailable',
  'no_trade_hub',
  'wave_disabled',
]);

export interface Ack { ok: boolean; appliedAtTick?: number; code?: string; detail?: string }

export interface GuildOfferSeen { offerId: string; action: string; resource: string; amount: number }

export interface GuildArrivedSeen {
  name: string;
  npcId: string;
  shipId: string;
  departAt: number;
  offers: GuildOfferSeen[];
}

export interface GuildLog { arrived: GuildArrivedSeen[]; departed: Array<{ npcId: string; shipId: string }> }

interface Online {
  __online: {
    planetId: string;
    colonyId: string | null;
    store: {
      latest: { colonies: Array<{ stage?: number; stock?: Record<string, number>; caps?: Record<string, number> }> } | null;
      onGuildArrived(fn: (p: GuildArrivedSeen) => void): () => void;
      onGuildDeparted(fn: (p: { npcId: string; shipId: string }) => void): () => void;
    };
    commands: { send(kind: string, args?: unknown): Promise<Ack> };
  };
  __w15?: GuildLog;
}

export const send = (page: Page, kind: string, args: unknown): Promise<Ack> =>
  page.evaluate(([k, x]) => (window as unknown as Online).__online.commands.send(k, x), [kind, args] as const);

export function armGuild(page: Page): Promise<void> {
  return page.evaluate(() => {
    const w = window as unknown as Online;
    if (w.__w15) return;
    const log: GuildLog = { arrived: [], departed: [] };
    w.__w15 = log;
    w.__online.store.onGuildArrived((p) => log.arrived.push(p));
    w.__online.store.onGuildDeparted((p) => log.departed.push(p));
  });
}

export const guildLog = (page: Page): Promise<GuildLog> =>
  page.evaluate(() => (window as unknown as Online).__w15 ?? { arrived: [], departed: [] });

export function seat(page: Page): Promise<{ planetId: string; colonyId: string | null; stage?: number; stock?: Record<string, number>; caps?: Record<string, number> }> {
  return page.evaluate(() => {
    const o = (window as unknown as Online).__online;
    const col = o.store.latest?.colonies?.[0];
    return { planetId: o.planetId, colonyId: o.colonyId, stage: col?.stage, stock: col?.stock, caps: col?.caps };
  });
}

export async function dev(name: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${urls().app}/v1/dev/commands/${name}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

export async function directorKey(method: 'POST' | 'DELETE', body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${urls().app}/v1/near/director-key`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer dev:${AS}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}
