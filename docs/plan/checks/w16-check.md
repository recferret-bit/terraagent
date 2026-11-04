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
   - **How:** wait until the **TICK** chip (top left) shows a number. It keeps increasing (about 5 per second). Press **`` ` ``**, then `director.plan`, then `director.trace`. Click the **Priorities** tab on the HQ panel (right side).
   - **See:** a flat hex planet and the HQ drone. Top right, under the wave chips, a plate whose only text is **DIRECTOR**. The wave chips show **26/26** and **W16** lit, source `server`. **HQ GOALS 0 / 2** offers **Establish Colony** (“Prepare site, place Command Hub, and build 1 extractor + 1 generator”) with **ACCEPT** and **DO IT MYSELF**. The add list also shows Grow Economy, Secure Power, and two “coming in a future wave” rows. **Priorities** shows **HQ PRIORITIES**, Economy **70**, Expansion **40**, Defense **50**, Power **60**, Terraform **30**, total **250**. The console prints:

     ```
     plan forced trigger=resource.shortage risk=conservative queue=1 trace=mock
     trace mock queue=1 outcome=proposed
     ```

     The plate does not print Conservative, a budget, or a rationale. Those stay in the sim seed and the console line (AI-13). `curl <app>/v1/readyz` returns `{"db":"ok","simThreads":17}` on this machine (threads follow the CPU).

2. **Risky comparison — not on the page.** `director.plan` always prints `risk=conservative`. There is no risk control in the HUD. Skip the click. The scenario unit test stores Conservative and refuses away raids: `npm test -w @terra/scenarios -- test/w16-director.spec.ts`.

3. **Protect a goal — not exercised.** **DO IT MYSELF** is on the Establish Colony card. This check did not click it, and a conflicting director proposal is not shown on the plate. Skip.

4. **Supersede and reload — not on the page.** Nothing delays a provider call or writes the policy into a reloadable game save from this HUD. Skip.

5. **Raid fault — not on the page.** Risky does not add a raid button. Skip. Policy tests keep `awayRaids` false.

6. **Hostile input and admin kill — not on the page.** There is no injection box and no admin token to type. Do not invent a credential. Skip. Regression coverage is `backend/app/test/ai/` (policy, outbox, kill switch). The kill switch is in memory.

7. **W11 / W27 context — not on the page.** The planet is one flat map. Sector summaries are not drawn. Skip. `shared/sim/test/systems/director-w11.spec.ts` and `director-w27.spec.ts` cover the fixtures.

8. **Worker and load numbers.**
   - **Where:** a second terminal in the worktree, with step 1’s page still open.
   - **How:** `npm run start -w @terra/director -- --check`
   - **See:** `director director up db=none`, then the prompt returns. The **TICK** chip keeps increasing. The process does not stay running, so there is nothing to Ctrl-C. The published load figures are in [`docs/plan/w16-director-load.md`](../w16-director-load.md): Apple M5 Pro, 50 samples, p95 **0.014 ms**, RSS **145 MB**, pool **in-memory 1**. That is not a Postgres queue (AI-12). The restart test restores in-memory objects in one process. It does not kill the database.

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

`npm run e2e -- --waves ..15` (earlier suites with W16 off) is the remaining full-suite gate. Do not treat it as green until that command finishes.

## When you're done

- **All good:** from the main checkout run `npm run wave -- land 16`. It re-runs the gates, merges this branch into `main`, tags `wave-16`, pushes, and removes the worktree and branch.
- **Something is wrong:** say which step and what you saw. Nothing lands until that is fixed on this branch.
