import type { Page } from '@playwright/test';
import {
  expect,
  expectNoPageErrors,
  hostMode,
  login,
  screenshot,
  test,
} from './harness';

/**
 * W08 Stages & HQ Goals — Wave E2E suite covering demo steps 1–8 (`docs/plan/waves/W08-stages-goals.md` §1 & W08-33).
 * Steps 1–5 and 8 are tagged `@hack` for `npm run e2e -- --waves ..08 --hack`.
 */
test.describe.configure({ mode: 'serial' });
test.beforeEach(() => {
  test.setTimeout(150_000);
});

const local = hostMode() === 'local';

interface OnlineColonyView {
  stage?: number;
  unlockStage?: number;
  threatStage?: number;
  stageOverride?: string;
  stageDwellRemainingS?: number | null;
  dwellRemainingS?: number | null;
  nextStageConditionText?: string;
  goalLimit?: number;
  goals?: Array<{
    id: string;
    goal: string;
    status: string;
    progress?: number;
    stepsCompleted?: number;
    stepsTotal?: number;
    childTaskIds?: string[];
  }>;
  priorities?: Record<string, number>;
  lastAutopilotDecision?: {
    stage: number;
    need: string;
    mode: string;
    target: string;
    lane: string;
    orderQueued: boolean;
  } | null;
  queue?: Array<{
    taskId: string;
    lane: string;
    precedence?: string;
    tag?: string;
    source?: string;
    state: string;
    goalId?: string;
    task?: { kind: string; building?: string; unit?: string; op?: string };
  }>;
}

interface OnlineDebugWindow {
  __online: {
    store: {
      latest: {
        tick: number;
        count: number;
        entities: Float32Array;
        colonies: OnlineColonyView[];
      } | null;
    };
    commands: {
      send(kind: string, args?: unknown): Promise<{ ok: boolean; appliedAtTick?: number; code?: string }>;
    };
  };
}

async function openW08(page: Page, params: Record<string, string> = {}): Promise<void> {
  const merged = { waves: '..08', shadow: '0', crt: '0', wind: '0', ...params };
  login(page);
  if (local) {
    await page.goto(`/play.html?${new URLSearchParams({ host: 'local', scenario: 'w08', ...merged })}`);
  } else {
    await page.goto(`/play.html?${new URLSearchParams({ scenario: 'w08', ...merged, as: 'e2e' })}`);
  }
  await expect(page.locator('.ta-tick__n').first()).toHaveText(/^\d+$/, { timeout: 90_000 });
}

const getColony0 = (page: Page) =>
  page.evaluate(() => (window as unknown as OnlineDebugWindow).__online.store.latest?.colonies?.[0] ?? null);

async function runConsole(page: Page, command: string): Promise<string> {
  const input = page.locator('[data-testid=dev-console] input');
  if (!(await input.isVisible().catch(() => false))) await page.keyboard.press('Backquote');
  await input.waitFor({ state: 'visible', timeout: 10_000 });
  const lines = page.locator('[data-testid=dev-console-output] > *');
  const before = await lines.count();
  await input.fill(command);
  await input.press('Enter');
  await expect.poll(() => lines.count(), { timeout: 10_000 }).toBeGreaterThan(before + 1);
  const all = await lines.allTextContents();
  return all.slice(before).join('\n');
}

test('@hack 1–4. S0 Landfall -> Accept Establish Colony -> S1 First Light toast & unlocks -> S2 dwell countdown & skip-dwell -> S2 The Grid', async ({
  page,
}) => {
  await openW08(page);

  await page.getByTestId('stage-goals-launcher').click();

  // Step 1: Start at S0 Landing
  await expect(page.locator('[data-testid="stage-track-hud"]')).toBeVisible();
  await expect(page.locator('[data-testid="stage-current-label"]')).toHaveText('S0 Landing');
  await expect(page.locator('[data-testid="stage-current-teaches"]')).toContainText('Prepare ground, then build');
  await expect(page.locator('[data-testid="stage-next-condition"]')).toContainText('Command Hub T1 complete · 1 min');

  // Build menu at S0: Command Hub unlocked, Metals Extractor & Solar greyed with "Unlocks at S1: Command Hub T1 complete", S2+ not listed
  const hubCard = page.locator('.ta-construction__card[data-building="commandHub"]');
  const extCard = page.locator('.ta-construction__card[data-building="metalsExtractor"]');
  const solarCard = page.locator('.ta-construction__card[data-building="solar"]');
  await expect(hubCard).toBeVisible();
  await expect(hubCard).toHaveAttribute('data-disabled', 'false');
  await expect(extCard).toBeVisible();
  await expect(extCard).toHaveAttribute('data-stage-locked', 'true');
  await expect(extCard).toContainText('Unlocks at S1: Command Hub T1 complete');
  await expect(solarCard).toBeVisible();
  await expect(solarCard).toHaveAttribute('data-stage-locked', 'true');
  await expect(solarCard).toContainText('Unlocks at S1: Command Hub T1 complete');
  await expect(page.locator('.ta-construction__card[data-building="supplyDepot"]')).toHaveCount(0);

  // Units menu at S0: Worker Drone T1 greyed with "Unlocks at S1: Command Hub T1 complete"
  await page.locator('[data-testid="dock-tab-production"]').click();
  const harvCard = page.locator('.ta-units__card[data-unit="worker"][data-tier="1"]');
  await expect(harvCard).toBeVisible();
  await expect(harvCard).toHaveAttribute('data-stage-locked', 'true');
  await expect(harvCard).toContainText('Unlocks at S1: Command Hub T1 complete');

  // Terraform menu at S0: TERRAFORM unlocked; Fill and Bridge (S2) not listed yet
  await page.locator('[data-testid="dock-tab-terraform"]').click();
  await expect(page.locator('[data-testid="tf-op-terraform"]')).toBeVisible();
  await expect(page.locator('[data-testid="tf-op-fill"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="tf-op-bridge"]')).toHaveCount(0);
  await page.locator('[data-testid="dock-tab-build"]').click();
  await screenshot(page, '1-s0-landfall');

  // Step 2: Guided first step — HQ Goals panel offers Establish Colony; click ACCEPT
  const suggestionCard = page.locator('[data-testid="goal-suggestion-card"]');
  await expect(suggestionCard).toBeVisible();
  await expect(suggestionCard).toContainText('Establish Colony');
  await expect(suggestionCard).toContainText('Prepare site, place Command Hub, and build 1 extractor + 1 generator');
  await page.locator('[data-testid="goal-suggestion-accept"]').click();

  await expect(page.locator('[data-testid="goals-limit-badge"]')).toHaveText('1 / 2');
  await expect(page.locator('[data-goal-kind="establish_colony"]')).toBeVisible();
  await expect
    .poll(async () => ((await getColony0(page))?.queue ?? []).length, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(3);
  await screenshot(page, '2-establish-colony-accepted');

  // Step 3: Reach S1 First Light when Command Hub finishes construction
  await runConsole(page, 'warp 20');
  await expect.poll(async () => (await getColony0(page))?.stage ?? 0, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  await runConsole(page, 'warp 1');
  await expect(page.locator('[data-testid="stage-current-label"]')).toHaveText('S1 First Light');
  await expect(page.locator('[data-testid="stage-reached-toast"]')).toBeVisible();
  await expect(page.locator('[data-testid="stage-toast-title"]')).toHaveText('S1 First Light');
  await expect(page.locator('[data-testid="stage-unlock-reveal"]')).toContainText('Worker Drone'); // S1 unlocks `worker` (tier 1 is the only tier open at S1)
  await expect(page.locator('[data-testid="stage-unlock-reveal"]')).toContainText('Metals Extractor');
  await expect(page.locator('[data-testid="stage-unlock-reveal"]')).toContainText('Solar Collector');

  // At S1: Metals Extractor and Solar un-grey; Builder, Pylon, Depot (unlockStage: 2) appear greyed
  await expect(extCard).toHaveAttribute('data-disabled', 'false');
  await expect(solarCard).toHaveAttribute('data-disabled', 'false');
  const depotCard = page.locator('.ta-construction__card[data-building="supplyDepot"]');
  await expect(depotCard).toBeVisible();
  await expect(depotCard).toHaveAttribute('data-stage-locked', 'true');
  await expect(depotCard).toHaveAttribute(
    'data-unlock-detail',
    'Unlocks at S2: extractor + generator complete · 2 min',
  );
  await screenshot(page, '3-s1-first-light');

  // Step 4: Extractor + Solar finish -> S2 trigger fires -> 2:00 dwell countdown -> stage skip-dwell -> S2 The Grid
  await runConsole(page, 'warp 25');
  await expect
    .poll(async () => (await getColony0(page))?.stageDwellRemainingS ?? null, { timeout: 20_000 })
    .not.toBeNull();
  await runConsole(page, 'warp 1');
  await expect(page.locator('[data-testid="stage-dwell-countdown"]')).toHaveText(/^\d+:\d\d$/);
  await screenshot(page, '4a-s2-dwell-countdown');

  const skipOut = await runConsole(page, 'stage skip-dwell');
  expect(skipOut).toContain('stage dwell skipped');
  await expect.poll(async () => (await getColony0(page))?.stage ?? 0, { timeout: 10_000 }).toBe(2);
  await expect(page.locator('[data-testid="stage-current-label"]')).toHaveText('S2 The Grid');
  await expect(page.locator('[data-testid="stage-toast-title"]')).toHaveText('S2 The Grid');
  await expect(depotCard).toHaveAttribute('data-disabled', 'false');
  await expect(page.locator('.ta-construction__card[data-building="pylon"]')).toHaveAttribute('data-disabled', 'false');
  await screenshot(page, '4b-s2-the-grid');
  expectNoPageErrors(page);
});

test('@hack 5. Priorities & "learn by hand, then automate": S2 suggestion only (0 orders), expansion=80 respects actual demand, S3 queues auto Wind order', async ({
  page,
}) => {
  await openW08(page);
  if (!local) await runConsole(page, 'warp 5');
  await runConsole(page, 'stage set 2');
  await expect.poll(async () => (await getColony0(page))?.stage ?? 0).toBe(2);

  await page.locator('[data-testid=hq-tab-priorities]').click();

  // Priorities panel: 5 sliders at 50, sum = 250
  await expect(page.locator('[data-testid="priorities-panel"]')).toBeVisible();
  await expect(page.locator('[data-testid="priority-sum"]')).toHaveText('250');

  // Inject a real power deficit: default preferences alone must not order generators.
  await runConsole(page, 'addLoad 30');
  // At S2 with unmet power demand: suggest wind and queue 0 orders.
  const outS2Wind = await runConsole(page, 'autopilot next');
  expect(outS2Wind).toContain('suggestion');
  expect(outS2Wind).toContain('wind');
  expect(((await getColony0(page))?.queue ?? []).filter((e) => e.precedence === 'ai' || e.tag === 'auto')).toHaveLength(
    0,
  );

  // A larger expansion preference does not invent territorial demand.
  const expSlider = page.locator('[data-testid="priority-slider-expansion"]');
  await expSlider.fill('80');
  await expSlider.dispatchEvent('change');
  await expect(page.locator('[data-testid="priority-value-expansion"]')).toHaveText('80');
  await expect(page.locator('[data-testid="priority-sum"]')).toHaveText('280');
  await expect.poll(async () => (await getColony0(page))?.priorities?.expansion ?? 50).toBe(80);

  const outS2Expand = await runConsole(page, 'autopilot next');
  expect(outS2Expand).toContain('suggestion');
  expect(outS2Expand).toContain('wind');
  expect(((await getColony0(page))?.queue ?? []).filter((e) => e.precedence === 'ai' || e.tag === 'auto')).toHaveLength(
    0,
  );
  await screenshot(page, '5a-s2-autopilot-suggestion');

  // Advance to S3 and run autopilot next again -> power need now queues an auto-tagged order for wind
  await runConsole(page, 'stage set 3');
  await expect.poll(async () => (await getColony0(page))?.stage ?? 0).toBe(3);
  const outS3Auto = await runConsole(page, 'autopilot next');
  expect(outS3Auto).toContain('auto');
  expect(outS3Auto).toContain('wind');

  await expect
    .poll(async () => {
      const q = (await getColony0(page))?.queue ?? [];
      return q.some((e) => (e.precedence === 'ai' || e.tag === 'auto') && e.task?.building === 'wind');
    })
    .toBe(true);
  await screenshot(page, '5b-s3-autopilot-auto-wind');
  expectNoPageErrors(page);
});

test('6 & 7. Safety override (fauna -> S3 First Contact immediately) and UnlockStage vs ThreatStage split', async ({
  page,
}) => {
  await openW08(page);
  if (!local) await runConsole(page, 'warp 5');
  await runConsole(page, 'stage set 1');
  await expect.poll(async () => (await getColony0(page))?.stage ?? 0).toBe(1);

  const trigOut = await runConsole(page, 'stage trigger fauna');
  expect(trigOut).toContain("stage override 'fauna' triggered -> S3 First Contact");
  await expect.poll(async () => (await getColony0(page))?.stage ?? 0).toBe(3);
  await expect(page.locator('[data-testid="stage-current-label"]')).toHaveText('S3 First Contact');
  await expect(page.locator('[data-testid="stage-toast-override"]')).toHaveText('Safety Override: fauna');
  await expect(page.locator('[data-testid="stage-unlock-reveal"]')).toContainText('Scout');
  await expect(page.locator('[data-testid="stage-unlock-reveal"]')).toContainText('Guard');
  await expect(page.locator('[data-testid="stage-unlock-reveal"]')).toContainText('Robotics Factory');
  await expect(page.locator('[data-testid="stage-unlock-reveal"]')).toContainText('Turret');

  // UnlockStage is >= 3 while ThreatStage reflects the colony's on-map footprint (< 3 on a bare colony)
  const col = await getColony0(page);
  expect(col?.unlockStage).toBeGreaterThanOrEqual(3);
  expect(col?.threatStage ?? 0).toBeLessThan(col?.unlockStage ?? 3);
  await screenshot(page, '6-fauna-safety-override-s3');
  expectNoPageErrors(page);
});

test.skip('7b. Profile page /me.html shows UnlockStage S4 across worlds (deferred to W12 Accounts & Profiles)', async () => {
  // W12 builds /me.html; the sim-side UnlockStage vs ThreatStage split is verified in step 6 & shared/sim unit tests.
});

test('@hack 8. Goal queue limit: HQ T1 allows 2 active+queued goals, rejects a 3rd with goal_limit, and frees the slot on cancel', async ({
  page,
}) => {
  await openW08(page);
  await runConsole(page, 'goal clear');
  await expect.poll(async () => ((await getColony0(page))?.goals ?? []).length).toBe(0);

  const g1 = await runConsole(page, 'goal add grow_economy metals 100');
  expect(g1).toContain('goal grow_economy queued');
  const g2 = await runConsole(page, 'goal add secure_power 100');
  expect(g2).toContain('goal secure_power queued');

  await expect(page.locator('[data-testid="goals-limit-badge"]')).toHaveText('2 / 2');
  await expect(page.locator('[data-testid="goal-add-btn"]')).toBeDisabled();

  // Attempting to add a 3rd goal rejects with goal_limit
  const g3 = await runConsole(page, 'goal add grow_economy minerals 100');
  expect(g3).toContain('goal_limit');
  await screenshot(page, '8-goal-limit-enforced');

  // Cancelling one goal frees the slot so the next can be added
  await page.keyboard.press('Backquote');
  const firstGoalId = (await getColony0(page))?.goals?.[0]?.id;
  expect(firstGoalId).toBeTruthy();
  await page.locator(`[data-testid="goal-cancel-${firstGoalId}"]`).click();
  await expect
    .poll(
      async () =>
        ((await getColony0(page))?.goals ?? []).filter((g) => g.status === 'active' || g.status === 'queued').length,
    )
    .toBe(1);
  await expect(page.locator('[data-testid="goals-limit-badge"]')).toHaveText('1 / 2');
  await expect(page.locator('[data-testid="goal-add-btn"]')).toBeEnabled();

  const g3Retry = await runConsole(page, 'goal add grow_economy minerals 100');
  expect(g3Retry).toContain('goal grow_economy queued');
  await expect(page.locator('[data-testid="goals-limit-badge"]')).toHaveText('2 / 2');
  expectNoPageErrors(page);
});

test('owner fixes: compact Goals launcher, clickable stages, minus and HQ tabs', async ({ page }) => {
  await openW08(page);
  await expect(page.getByTestId('stage-track-hud')).toBeHidden();
  await expect(page.getByTestId('stage-goals-launcher')).toHaveText('Goals · S0');
  await runConsole(page, 'stage set 2');
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('stage-toast-countdown')).toContainText(/Closes in \d+s/);
  await page.getByTestId('stage-toast-dismiss').click();
  await page.getByTestId('stage-segment-S2').click();
  await expect(page.getByTestId('stage-toast-countdown')).toHaveCount(0);
  await page.getByTestId('stage-segment-S1').click();
  await expect(page.getByTestId('stage-toast-title')).toHaveText('S1 First Light');
  expect((await getColony0(page))?.stage).toBe(2);
  await page.getByTestId('stage-goals-close').click();
  await expect(page.getByTestId('stage-track-hud')).toBeHidden();
  await expect(page.getByTestId('stage-reached-toast')).toHaveCount(0);
  await page.getByTestId('stage-goals-launcher').click();
  await expect(page.getByTestId('stage-track-hud')).toBeVisible();
  await expect(page.getByTestId('stage-guide-previous')).toHaveCount(0);
  await page.getByTestId('stage-segment-S10').click();
  await expect(page.getByTestId('stage-guide-text')).toContainText('W21');
  await expect(page.getByTestId('stage-guide-text')).toContainText('Preview');
  await page.getByTestId('hq-tab-priorities').click();
  await expect(page.getByTestId('priorities-panel')).toBeVisible();
  await expect(page.getByTestId('goals-panel')).toBeHidden();
  await page.getByTestId('hq-tab-goals').click();
  await expect(page.getByTestId('goals-panel')).toBeVisible();
  await expect(page.getByTestId('priorities-panel')).toBeHidden();
  await screenshot(page, 'owner-stage-guide-and-hq-tabs');
  expectNoPageErrors(page);
});

test('owner fixes: Grow Metals issues real work and completes from production', async ({ page }) => {
  test.setTimeout(120_000);
  await openW08(page);
  await page.getByTestId('goal-suggestion-accept').click();
  await runConsole(page, 'warp 20');
  await expect.poll(async () => (await getColony0(page))?.goals?.find((g) => g.goal === 'establish_colony')?.status,
    { timeout: 60_000 }).toBe('done');
  await runConsole(page, 'warp 1');
  await runConsole(page, 'goal add grow_economy metals 100');
  await expect.poll(async () => (await getColony0(page))?.queue?.filter((e) => e.goalId && e.goalId !== 'goal_0_1').length ?? 0).toBeGreaterThan(0);
  await runConsole(page, 'warp 20');
  await expect.poll(async () => (await getColony0(page))?.goals?.find((g) => g.goal === 'grow_economy')?.status,
    { timeout: 60_000 }).toBe('done');
  await runConsole(page, 'warp 1');
  await screenshot(page, 'owner-grow-metals-completed');
  expectNoPageErrors(page);
});
