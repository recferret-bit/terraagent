# W12 fixes — owner check

Worktree: `TerraAgent-wt/w12`, branch `wave/w12-player-page-achievements`.
Client: http://127.0.0.1:5673/ · Backend: http://127.0.0.1:4501/v1/healthz.
Run `npm run dev` in this worktree if the stack is stopped. The runner applies database migrations.

1. Open http://127.0.0.1:5673/. The **PILOT / ME** card is a clearly labeled mock. Click **OPEN MOCK PILOT**: `/me.html?as=w12` opens in a new browser tab.
2. On ME, inspect the six sections: PILOT, PROGRESS, PLANETS, HISTORY, ACHIEVEMENTS, PLAY. Each has a contrasting plate, blue upper border, larger heading and increased separation. Click every sticky navigation tab. Check at desktop width and at 390 px; no horizontal overflow should appear.
3. In PLANETS, click the mock colony's **Dive in**. It enters `/play.html?scenario=w12&as=w12`, a supported scenario. This is a demonstration colony, not a live join to the mock planet ID. Gameplay has no PILOT / ME chip or profile links in achievement/XP toasts.
4. Open http://127.0.0.1:5673/landing.html in a fresh browser context. Guest sign-in controls appear in the header; ME is absent. Continue with Google or X (mock), complete the popup login, then click the pilot link. ME opens in a new tab for the authenticated pilot, without receiving W12 demo statistics.
5. Repeat from http://127.0.0.1:5673/play.html?planet=dune on the planet-selection screen. The same controls appear. After login, deploying/resuming refreshes that session instead of silently switching to a new guest.
6. For the explicit mock, open http://127.0.0.1:5673/play.html?scenario=w12&as=w12. Press the **`** key for the in-game dev console. Run `fact add groundbreaker 200`, then refresh http://127.0.0.1:5673/me.html?as=w12. The counter advances and any newly met tier earns XP once. A zero delta must not award it again. Existing persistent demo progress can differ from the original 800-tile baseline.
7. Run `npm test -- --run backend/app/test/progression backend/app/test/profile frontend/game/pages/me frontend/game/features/identity frontend/game/features/achievements/w12-toasts.spec.ts frontend/game/app/online`.
8. Run `npm run test:integration -- backend/app/test/progression/progression-engine.int.spec.ts`. It creates and drops an isolated database. Verify source-to-profile persistence, all 60 tiers, replay, rollback, concurrent updates, cross-player isolation, independent effects, retries and expired leases.

External badge minting and notifications remain queued for their future adapters. Live colony-specific resume and stage projection are W11 follow-ups. The pre-commit sim event delivery gap is tracked in **BE-48**; consumer wiring in **BE-49**; live colony projection/resume in **BE-50** in [backend limitations](../../questions-and-limitations/backend-contracts.md). Architecture and future-wave gates: [Progression engine](../../spec/PROGRESSION_ENGINE.md).

Validation recorded: 138 targeted unit tests and 10 PostgreSQL integration tests passed; frontend/backend/e2e TypeScript checks, focused lint, structure checks and production build passed. Browser checks covered the hub popup, authenticated landing login, zero demo achievements on a fresh account, planet-selection new-tab link, mobile overflow and a ticking mock Dive in with no ME HUD link. The build retains existing dependency annotation/chunk-size warnings.

Full owner-check rerun (2026-11-04, implementation `7f2ddad`): **138/138 unit tests**, **10/10 PostgreSQL integration tests**, and **7/7 implemented W12 E2E tests** passed. Run the complete browser suite with `npm run e2e -- --waves 12` (without `--hack`); it creates a fresh database and starts an isolated stack on client 5674 / app 4502 with later waves off. Its three explicit skips are full colony-card acceptance (W12-17), history filtering/infinite scroll (W12-10/11/18), and badge mint UI delivery (W12-25/26). They are not passing tests.

The additional browser owner checks passed: hub new-tab mock link; all six tabs at 1280 px and 390 px without horizontal overflow; mock Dive in reaching a ticking game with no ME HUD; Google login on landing and X login on selection, each opening a fresh authenticated profile with zero mock awards; authenticated gameplay resume preserving the player and linked account; `fact add groundbreaker 200` persisting the increment and `fact add groundbreaker 0` changing neither counter nor XP.

Do not use `E2E_REUSE=1` for the suite's fixed seed assertions unless the demo pilot is known to be at its initial baseline. This rerun first reused the existing stack and stopped at the expected 1,120 XP assertion because the pilot already had 1,270 XP. The subsequent isolated run passed; no application code was changed for the rerun. Browser artifacts are in `tests/e2e/.out/report/` and `tests/e2e/.out/results/`.

After review, land through `npm run wave -- land 12`.
