import { createHash } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from './harness';

/** W28 e2e helpers (`tests/e2e/w28.spec.ts`). The pilot is the dev session `w28` (`Bearer dev:w28`). */
export const PILOT = 'w28';
export const POOL = 'astro-stakers.pool.mock';
export const RIVAL = 'w28-rival.terraagent.mock';
export const AUTH = { authorization: `Bearer dev:${PILOT}`, 'content-type': 'application/json' };

/** Same derivation as `W28ScenarioSeedService` (`w28PilotAccountId`): the pilot's seeded, linked NEAR wallet. */
export function pilotAccount(playerId: string): string {
  return `w28-${createHash('sha256').update(playerId).digest('hex').slice(0, 10)}.terraagent.mock`;
}

export interface Perks {
  readonly tier: number;
  readonly feeTier: number;
  readonly platformFeeBp: number;
  readonly feeWarmupReadyAtMs: number | null;
  readonly activeStakedNear: string;
  readonly leadPatronPlanetIds: string[];
}

export async function postJson<T = Record<string, unknown>>(api: APIRequestContext, path: string, body: unknown): Promise<{ status: number; body: T }> {
  const res = await api.post(path, { headers: AUTH, data: body });
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as T };
}

export async function getJson<T = Record<string, unknown>>(api: APIRequestContext, path: string, auth = false): Promise<{ status: number; body: T }> {
  const res = await api.get(path, auth ? { headers: AUTH } : {});
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as T };
}

/** Clock-aware wallet status (`GET /v1/near/staking?accountId=`): perks follow the staking clock that `time.warp` moves. */
export async function walletPerks(api: APIRequestContext, accountId: string): Promise<Perks> {
  const res = await getJson<{ perks: Perks }>(api, `/v1/near/staking?accountId=${encodeURIComponent(accountId)}`, true);
  expect(res.status).toBe(200);
  return res.body.perks;
}

/** The seated player's id and linked wallet as the server knows them (`GET /v1/me/profile` with the dev session). */
export async function pilotIdentity(api: APIRequestContext): Promise<{ playerId: string; accountId: string | null }> {
  const res = await getJson<{ identity: { playerId: string; accountId: string | null } }>(api, '/v1/me/profile', true);
  expect(res.status).toBe(200);
  return res.body.identity;
}

/** Sets a range input and fires `input` (Playwright `fill` does not drive sliders). */
export async function setSlider(page: Page, selector: string, value: number): Promise<void> {
  await page.locator(selector).evaluate((el, v) => {
    const input = el as HTMLInputElement;
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

export async function noHorizontalScroll(page: Page): Promise<void> {
  const [scroll, inner] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scroll).toBeLessThanOrEqual(inner + 1);
}

export async function planetIdOf(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { __online?: { planetId?: string } }).__online?.planetId ?? '');
}
