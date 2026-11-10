# W16 — Player-directed AI Strategy: owner check

> The wave's demo story ([`waves/W16-ai-director.md`](../waves/W16-ai-director.md)) as a hands-on checklist. Format and rules: [`README.md`](./README.md). About 10 minutes for the steps that have a page. Steps 2–8 and the admin kill are not on the page yet.

## Before you start

- **Where it runs:** branch `wave/w16-ai-director`, worktree `/Users/ferretrec/work/TerraAgent-wt/w16`. The main checkout is untouched.
- **Ports:** `TA_PORT_BASE=4200` → app **4201**, client **5373**. Database `terra_wave_w16_ai_director`. Below, `<client>` = `http://127.0.0.1:5373`, `<app>` = `http://127.0.0.1:4201`.
- **Start in mock mode.** From the worktree:

  ```bash
  AI_PROVIDER=mock npm run dev
  ```

  The prefix keeps this check on the mock adapter. A gitignored `infra/.env` may already contain `AI_PROVIDER=zai` and a key. Do not print that file. Do not put the key in `infra/.env.worktree` (a later wave rewrite can drop extra lines from that file once the port lines are missing). `infra/.env` is the file to keep.
- **Stop:** Ctrl-C in that terminal, or `kill $(cat scripts/dev/.out/runner.pid)` if it was started in the background. Postgres keeps running.
- **Dev console:** on the game page press **`` ` ``** (the key under Esc). Type in the dark panel at the bottom and press Enter. It is not the browser DevTools console. Click the game first if DevTools has focus.
- **Director worker:** `npm run start -w @terra/director -- --check` prints one line and exits. It does not connect to the game.
- Tools: [`docs/dev/DEV_TOOLS.md`](../../dev/DEV_TOOLS.md).

## Steps

1. **Plate, goals, priorities, mock plan.**
   - **Where:** `<client>/play.html?scenario=w16&as=w16`
   - **How:** press **`` ` ``** and run `tick`: it prints a number that keeps increasing (about 5 per second). Then run `flags`, `director.plan`, then `director.trace`. Open the **HQ AI** spine tab of the left-hand Colony book and click its **Priorities** tab.
   - **See:** a flat hex planet and the HQ drone. In the left-hand Colony book, the **DIRECTOR** spine tab (`[data-testid="colony-tab-director"]`) displays the live policy summary `conservative · resources · 15% commit / 40% reserve`, interactive risk (`conservative` / `risky`), preset (`balanced` / `defense` / `expansion` / `resources` / `terraforming` / `trade`), pause, and note controls, plus the action list. **HQ GOALS 0 / 2** offers **Establish Colony** (“Prepare site, place Command Hub, and build 1 extractor + 1 generator”) with **ACCEPT** and **DO IT MYSELF**. **Priorities** shows **HQ PRIORITIES**, Economy **70**, Expansion **40**, Defense **50**, Power **60**, Terraform **30**, total **250**. The console prints:

     ```
     plan forced trigger=resource.shortage risk=conservative queue=1 trace=mock
     trace mock queue=1 outcome=proposed
     ```

     The plate's action list renders `grow-economy · applied — 15% commit · Hold one grow_economy goal at the conservative commitment.` `curl <app>/v1/readyz` returns `{"db":"ok","simThreads":17}` on this machine (threads follow the CPU).

2. **Risky comparison.**
   - **Where:** same page (`<client>/play.html?scenario=w16&as=w16`).
   - **How:** on the **DIRECTOR** plate, change the Risk dropdown from `conservative` to `risky`. Press **`` ` ``** and run `director.plan`, then `director.trace`.
   - **See:** the policy summary updates to `risky · resources · 35% commit / 15% reserve`, any previous open row transitions to `superseded` as `intentRevision` increments, and `director.plan` prints `plan forced trigger=resource.shortage risk=risky queue=1 trace=mock` while rendering 2 actions (`grow-economy` at `35% commit` and `harvest-metals`).

3. **Protect a goal (`locked_goal`).**
   - **Where:** same page.
   - **How:** in the dev console (`` ` ``), run `director.plan locked_goal`.
   - **See:** the console prints `plan forced trigger=resource.shortage risk=risky fault=locked_goal outcome=rejected queue=1 trace=mock` and the **DIRECTOR** plate shows `cancel-manual · rejected (locked_goal) — Player-locked goal preserved.`

4. **Supersede (`stale_revision` / policy change).**
   - **Where:** same page.
   - **How:** run `director.plan` so an `applied` row is visible on the **DIRECTOR** plate, then toggle the Preset dropdown (e.g. to `defense`) or run `director.plan stale_revision`.
   - **See:** changing policy increments `intentRevision` and marks prior `applied` rows `superseded`; running `director.plan stale_revision` prints `outcome=superseded` and renders `grow-economy · superseded (stale_revision) — Superseded by newer player intent.`

5. **Raid fault (`raid_proposal`).**
   - **Where:** same page (even with Risk set to `risky`).
   - **How:** in the dev console (`` ` ``), run `director.plan raid_proposal`.
   - **See:** the console prints `plan forced trigger=resource.shortage risk=risky fault=raid_proposal outcome=unauthorized queue=1 trace=mock` and the **DIRECTOR** plate shows `act-raid · rejected (away_raids) — Raid proposals are outside director authority.`

6. **Hostile input and admin kill — not on the page.** There is no injection box and no admin token to type. Do not invent a credential. Skip. Regression coverage is `backend/app/test/ai/` (policy, outbox, kill switch). The kill switch is in memory.

7. **W11 / W27 context — not on the page.** The planet is one flat map. Sector summaries are not drawn. Skip. `shared/sim/test/systems/director-w11.spec.ts` and `director-w27.spec.ts` cover the fixtures.

8. **Worker and load numbers.**
   - **Where:** a second terminal in the worktree, with step 1’s page still open.
   - **How:** `npm run start -w @terra/director -- --check`
   - **See:** `director director up db=none`, then the prompt returns. The console command `tick` keeps increasing. The process does not stay running, so there is nothing to Ctrl-C. The published load figures are in [`docs/plan/w16-director-load.md`](../w16-director-load.md): Apple M5 Pro, 50 samples, p95 **0.014 ms**, RSS **145 MB**, pool **in-memory 1**. That is not a Postgres queue (AI-12). The restart test restores in-memory objects in one process. It does not kill the database.

9. **W16 off.**
   - **Where:** `<client>/play.html?scenario=w16&as=w16&waves=..15`
   - **See:** the **DIRECTOR** plate is gone. Wave chips show **16/26**, **W16** unlit, source `?waves= override`. **HQ GOALS** and the planet remain. The tick still increases.

10. **Live report — already recorded. Do not call the provider again for this check.**
    - **Where:** [`docs/plan/w16-live-report.md`](../w16-live-report.md)
    - **See:** ok true, model **glm-5.3**, latency **1763 ms**, input tokens **21**, output tokens **16**, error none. The key and the prompt text are not in that file. One ping is not a strategy pass (AI-10).

## Automated checks

Green on this branch while writing the guide:

- `npm run typecheck`
- `node scripts/check-structure.mjs`
- `npm test -w @terra/scenarios -- test/w16-director.spec.ts`
- `npm test -w @terra/director`
- `npm run e2e -- --waves 16` → 2 passed (server)
- `npm run e2e -- --waves 16 --host local` → 2 passed (browser host)
- `npm run e2e -- --waves ..15` → 60 passed, then two failures: the W03 dismantle click stuck on the stage-toast countdown, and the W06 saving chip was already the retry toast. After those two harness fixes, the same `--waves ..15` grep re-ran the W03 dismantle, the W02 dismantle hotkey, and W06 steps 1, 6, and 7: 5 passed. The other 60 were not repeated after the harness edit.

## When you're done

- **All good:** from the main checkout run `npm run wave -- land 16`. It re-runs the gates, merges this branch into `main`, tags `wave-16`, pushes, and removes the worktree and branch.
- **Something is wrong:** say which step and what you saw. Nothing lands until that is fixed on this branch.
