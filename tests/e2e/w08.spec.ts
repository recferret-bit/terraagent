import type { Page } from '@playwright/test';
import {
  devConsole,
  expect,
  expectNoPageErrors,
  hostMode,
  loadLocal,
  loadScenario,
  screenshot,
  test,
} from './harness';

/**
 * W08 Stages & HQ Goals — Wave E2E suite covering demo steps 1–8 (`docs/plan/waves/W08-stages-goals.md` §1 & W08-33).
 * Steps 1–5 and 8 are tagged `@hack` for `npm run e2e -- --waves ..08 --hack`.
 */
test.describe.configure({ mode: 'serial' });

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
  if (local) {
    await loadLocal(page, 'w08', params);
  } else {
    await loadScenario(page, 'w08', params);
  }
}

const getColony0 = (page: Page) =>
  page.evaluate(() => (window as unknown as OnlineDebugWindow).__online.store.latest?.colonies?.[0] ?? null);

test('@hack 1–4. S0 Landfall -> Accept Establish Colony -> S1 First Light toast & unlocks -> S2 dwell countdown & skip-dwell -> S2 The Grid', async ({
  page,
}) => {
  await openW08(page);

  // Step 1: Start at S0 Landfall
  await expect(page.locator('[data-testid="stage-track-hud"]')).toBeVisible();
  await expect(page.locator('[data-testid="stage-current-label"]')).toHaveText('S0 Landfall');
  await expect(page.locator('[data-testid="stage-current-teaches"]')).toContainText(
    'You have one worker (your HQ), a starter site, and a Hub to place',
  );
  await expect(page.locator('[data-testid="stage-next-condition"]')).toContainText('Command Hub T1 complete · 1 min');

  // Build menu at S0: Command Hub unlocked, Metals Extractor & Solar greyed with "Unlocks at S1: Command Hub complete", S2+ not listed
  const hubCard = page.locator('[data-testid="build-card-commandHub"]');
  const extCard = page.locator('[data-testid="build-card-metalsExtractor"]');
  const solarCard = page.locator('[data-testid="build-card-solar"]');
  await expect(hubCard).toBeVisible();
  await expect(hubCard).toHaveAttribute('data-stage-locked', 'false');
  await expect(extCard).toBeVisible();
  await expect(extCard).toHaveAttribute('data-stage-locked', 'true');
  await expect(extCard).toContainText('Unlocks at S1: Command Hub complete');
  await expect(solarCard).toBeVisible();
  await expect(solarCard).toHaveAttribute('data-stage-locked', 'true');
  await expect(solarCard).toContainText('Unlocks at S1: Command Hub complete');
  await expect(page.locator('[data-testid="build-card-depot"]')).toHaveCount(0);

  // Units menu at S0: Harvester greyed with "Unlocks at S1: Command Hub complete"
  await page.locator('[data-testid="dock-tab-production"]').click();
  const harvCard = page.locator('[data-testid="unit-card-harvester"]');
  await expect(harvCard).toBeVisible();
  await expect(harvCard).toHaveAttribute('data-stage-locked', 'true');
  await expect(harvCard).toContainText('Unlocks at S1: Command Hub complete');

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
  await devConsole(page, 'warp 20');
  await expect.poll(async () => (await getColony0(page))?.stage ?? 0, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  await expect(page.locator('[data-testid="stage-current-label"]')).toHaveText('S1 First Light');
  await expect(page.locator('[data-testid="stage-reached-toast"]')).toBeVisible();
  await expect(page.locator('[data-testid="stage-toast-title"]')).toHaveText('S1 First Light');
  await expect(page.locator('[data-testid="stage-toast-unlocks"]')).toContainText('Harvester');
  await expect(page.locator('[data-testid="stage-toast-unlocks"]')).toContainText('Metals Extractor');
  await expect(page.locator('[data-testid="stage-toast-unlocks"]')).toContainText('Solar Collector');

  // At S1: Metals Extractor and Solar un-grey; Builder, Pylon, Depot (unlockStage: 2) appear greyed
  await expect(extCard).toHaveAttribute('data-stage-locked', 'false');
  await expect(solarCard).toHaveAttribute('data-stage-locked', 'false');
  const depotCard = page.locator('[data-testid="build-card-depot"]');
  await expect(depotCard).toBeVisible();
  await expect(depotCard).toHaveAttribute('data-stage-locked', 'true');
  await expect(depotCard).toHaveAttribute(
    'data-unlock-detail',
    'Unlocks at S2: extractor + generator complete · 2 min',
  );
  await screenshot(page, '3-s1-first-light');

  // Step 4: Extractor + Solar finish -> S2 trigger fires -> 2:00 dwell countdown -> stage skip-dwell -> S2 The Grid
  await devConsole(page, 'warp 35');
  await expect
    .poll(async () => (await getColony0(page))?.stageDwellRemainingS ?? null, { timeout: 15_000 })
    .not.toBeNull();
  await expect(page.locator('[data-testid="stage-dwell-countdown"]')).toHaveText(/^\d+:\d\d$/);
  await screenshot(page, '4a-s2-dwell-countdown');

  const skipOut = await devConsole(page, 'stage skip-dwell');
  expect(skipOut).toContain('stage dwell skipped');
  await expect.poll(async () => (await getColony0(page))?.stage ?? 0, { timeout: 10_000 }).toBe(2);
  await expect(page.locator('[data-testid="stage-current-label"]')).toHaveText('S2 The Grid');
  await expect(page.locator('[data-testid="stage-toast-title"]')).toHaveText('S2 The Grid');
  await expect(depotCard).toHaveAttribute('data-stage-locked', 'false');
  await expect(page.locator('[data-testid="build-card-pylon"]')).toHaveAttribute('data-stage-locked', 'false');
  await screenshot(page, '4b-s2-the-grid');
  expectNoPageErrors(page);
});

test('@hack 5. Priorities & "learn by hand, then automate": S2 suggestion only (0 orders), expansion=80 shifts to outpostBeacon, S3 queues auto Wind order', async ({
  page,
}) => {
  await openW08(page);
  await devConsole(page, 'stage set 2');
  await expect.poll(async () => (await getColony0(page))?.stage ?? 0).toBe(2);

  // Priorities panel: 5 sliders at 50, sum = 250
  await expect(page.locator('[data-testid="priorities-panel"]')).toBeVisible();
  await expect(page.locator('[data-testid="priority-sum"]')).toHaveText('250');

  // At S2 with default priorities: autopilot next emits suggestion for wind and queues 0 orders
  const outS2Wind = await devConsole(page, 'autopilot next');
  expect(outS2Wind).toContain('suggestion');
  expect(outS2Wind).toContain('wind');
  expect(((await getColony0(page))?.queue ?? []).filter((e) => e.precedence === 'ai' || e.tag === 'auto')).toHaveLength(
    0,
  );

  // Move expansion slider to 80 -> suggestion shifts toward outpostBeacon (0 orders queued)
  const expSlider = page.locator('[data-testid="priority-slider-expansion"]');
  await expSlider.fill('80');
  await expSlider.dispatchEvent('change');
  await expect(page.locator('[data-testid="priority-value-expansion"]')).toHaveText('80');
  await expect(page.locator('[data-testid="priority-sum"]')).toHaveText('280');
  await expect.poll(async () => (await getColony0(page))?.priorities?.expansion ?? 50).toBe(80);

  const outS2Expand = await devConsole(page, 'autopilot next');
  expect(outS2Expand).toContain('suggestion');
  expect(outS2Expand).toContain('outpostBeacon');
  expect(((await getColony0(page))?.queue ?? []).filter((e) => e.precedence === 'ai' || e.tag === 'auto')).toHaveLength(
    0,
  );
  await screenshot(page, '5a-s2-autopilot-suggestion');

  // Advance to S3 and run autopilot next again -> power need now queues an auto-tagged order for wind
  await devConsole(page, 'stage set 3');
  await expect.poll(async () => (await getColony0(page))?.stage ?? 0).toBe(3);
  const outS3Auto = await devConsole(page, 'autopilot next');
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
  await devConsole(page, 'stage set 1');
  await expect.poll(async () => (await getColony0(page))?.stage ?? 0).toBe(1);

  const trigOut = await devConsole(page, 'stage trigger fauna');
  expect(trigOut).toContain("stage override 'fauna' triggered -> S3 First Contact");
  await expect.poll(async () => (await getColony0(page))?.stage ?? 0).toBe(3);
  await expect(page.locator('[data-testid="stage-current-label"]')).toHaveText('S3 First Contact');
  await expect(page.locator('[data-testid="stage-toast-override"]')).toHaveText('Safety Override: fauna');
  await expect(page.locator('[data-testid="stage-toast-unlocks"]')).toContainText('Scout');
  await expect(page.locator('[data-testid="stage-toast-unlocks"]')).toContainText('Guard');
  await expect(page.locator('[data-testid="stage-toast-unlocks"]')).toContainText('Robotics Factory');
  await expect(page.locator('[data-testid="stage-toast-unlocks"]')).toContainText('Turret');

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
  await devConsole(page, 'goal clear');
  await expect.poll(async () => ((await getColony0(page))?.goals ?? []).length).toBe(0);

  const g1 = await devConsole(page, 'goal add grow_economy metals 10');
  expect(g1).toContain('goal grow_economy queued');
  const g2 = await devConsole(page, 'goal add secure_power 15');
  expect(g2).toContain('goal secure_power queued');

  await expect(page.locator('[data-testid="goals-limit-badge"]')).toHaveText('2 / 2');
  await expect(page.locator('[data-testid="goal-add-btn"]')).toBeDisabled();

  // Attempting to add a 3rd goal rejects with goal_limit
  const g3 = await devConsole(page, 'goal add defend_colony');
  expect(g3).toContain('goal_limit');
  await screenshot(page, '8-goal-limit-enforced');

  // Cancelling one goal frees the slot so the next can be added
  const firstGoalId = (await getColony0(page))?.goals?.[0]?.id;
  expect(firstGoalId).toBeTruthy();
  await page.locator(`[data-testid="goal-cancel-${firstGoalId}"]`).click();
  await expect(page.locator('[data-testid="goals-limit-badge"]')).toHaveText('1 / 2');
  await expect(page.locator('[data-testid="goal-add-btn"]')).toBeEnabled();

  const g3Retry = await devConsole(page, 'goal add defend_colony');
  expect(g3Retry).toContain('goal defend_colony queued');
  await expect(page.locator('[data-testid="goals-limit-badge"]')).toHaveText('2 / 2');
  expectNoPageErrors(page);
});
