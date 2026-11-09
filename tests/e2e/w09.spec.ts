import type { APIRequestContext, Page } from '@playwright/test';
import {
  CONSOLE, devConsole, expect, expectNoPageErrors, hostMode, loadLocal, loadScenario, test, urls,
} from './harness';

/**
 * W09 offline notifications — hackathon slice (W09-33).
 * `@hack`: a rejoin shows the while-you-were-away plate, and the mock notifier has one `under_attack` row.
 * The local-host case only checks that `away` then `back` prints the tick lines. The digest is server-only:
 * `?host=local` has no join `welcome.away`.
 * Not covered here (the wave file defers them): Away settings, Web Push, a second tab, coarse-dt parity.
 */
test.describe.configure({ mode: 'serial' });

const local = hostMode() === 'local';
const serverOnly = () => test.skip(local, 'needs the app (server host)');

interface OnlineSeat {
  __online: {
    planetId: string;
    colonyId: string | null;
    transport: { dispose(): void };
  };
}

const seatOf = (page: Page) => page.evaluate(() => {
  const online = (window as unknown as OnlineSeat).__online;
  return { planetId: online.planetId, colonyId: online.colonyId };
});

async function dropSocket(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as OnlineSeat).__online.transport.dispose());
  await page.waitForTimeout(400);
}

async function fireAttack(request: APIRequestContext, colonyId: string, planetId: string): Promise<void> {
  const res = await request.post(`${urls().app}/v1/dev/notify/test`, {
    data: { colonyId, planetId, eventId: `e2e:under_attack:${colonyId}` },
  });
  expect(res.status(), await res.text()).toBe(200);
}

test('@hack rejoin shows the away digest and the mock notifier recorded an attack', async ({ page, request }) => {
  test.setTimeout(120_000);
  serverOnly();
  await loadScenario(page, 'w09');
  await expect.poll(() => seatOf(page).then((s) => s.colonyId ?? ''), { timeout: 15_000 }).toMatch(/^co_/);
  const seat = await seatOf(page);
  const colonyId = seat.colonyId as string;
  expect(seat.planetId).toMatch(/^pl_/);
  const away = await devConsole(page, 'away');
  expect(away).toMatch(/away at tick \d+/);
  await page.waitForTimeout(400);
  await dropSocket(page);
  await fireAttack(request, colonyId, seat.planetId);
  const listed = await request.get(`${urls().app}/v1/dev/notify?colonyId=${encodeURIComponent(colonyId)}`);
  expect(listed.status()).toBe(200);
  const body = (await listed.json()) as { rows: Array<{ kind: string; colonyId: string }> };
  expect(body.rows.filter((row) => row.kind === 'under_attack' && row.colonyId === colonyId)).toHaveLength(1);

  await page.goto(`/play.html?${new URLSearchParams({ join: seat.planetId, as: 'e2e' })}`);
  await expect(page.locator('.ta-tick__n').first()).toHaveText(/^\d+$/, { timeout: 90_000 });
  const plate = page.locator('[data-testid=away-digest]');
  await expect(plate).toBeVisible({ timeout: 15_000 });
  await expect(plate).toContainText(/while you were away/i);
  await expect(page.locator('[data-testid=away-duration]')).toContainText(/\d/);
  await expect(page.locator('[data-testid=away-attacks]')).toContainText(/Attacks/);
  expectNoPageErrors(page);
});

test('@hack local host: away then back does not throw', async ({ page }) => {
  await loadLocal(page, 'w09');
  expect(await devConsole(page, 'away')).toMatch(/away at tick \d+/);
  expect(await devConsole(page, 'back')).toMatch(/back at tick \d+/);
  expect(page.locator(CONSOLE.line).filter({ hasText: /error:/ })).toHaveCount(0);
  expectNoPageErrors(page);
});
