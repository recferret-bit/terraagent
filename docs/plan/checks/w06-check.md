# W06 — Invisible Chain: owner check

> The wave's demo story ([`waves/W06-invisible-chain.md`](../waves/W06-invisible-chain.md)) as a hands-on checklist. Format and rules: [`README.md`](./README.md). About 15 minutes. Steps 3 and 5 are not in this landing.

## Before you start

- **Where it runs:** branch `wave/w06-invisible-chain`, worktree `../TerraAgent-wt/w06`. Your main checkout is untouched.
- **Ports:** this worktree's `infra/.env.worktree` sets `TA_PORT_BASE=4200` → app **4201**, client **5373** (`TA_DB_NAME=terra_wave_w06_invisible_chain`). Below, `<client>` = `http://127.0.0.1:5373`, `<app>` = `http://127.0.0.1:4201`.
- **Start the stack** (if it isn't already up): `cd ../TerraAgent-wt/w06 && npm run dev` (Docker must be running for Postgres). Stop it with Ctrl-C, or `kill $(cat scripts/dev/.out/runner.pid)` if it was started in the background. Restart the app only with `npm run dev:restart` (Vite keeps running).
- **Dev console:** in the game page press **`` ` ``** (the key under Esc). A dark panel opens at the bottom; type commands there and press Enter. It is **not** the browser's DevTools console. Click the game first if DevTools has focus.
- **Mock login:** Save progress opens a popup. If the browser blocks popups, allow them for `127.0.0.1:5373`.
- **W02 is on this branch.** `main` (W02 First Light) is merged here. `?scenario=w06` enables waves through W06, so the First Light chrome is on the same screen as the guest chip: resource chips, the energy chip, the planet clock, and the Command Dock (`BUILD`, `PRODUCTION`, `TERRAFORM`, `QUEUE`). The colony itself is still the W01 landfall start (pod, colony 0), not the W02 stocked Hub scenario. W02's own story is `<client>/play.html?scenario=w02`; follow [`w02-check.md`](./w02-check.md) for what to click, and use this worktree's ports (5373 / 4201), not the ports written in that file.
- Every tool used below is described in [`docs/dev/DEV_TOOLS.md`](../../dev/DEV_TOOLS.md).

## Steps

1. **Guest with a colony.** Open `<client>/play.html?scenario=w06`. A temperate planet loads (no orbit menu). Top left, a chip reads **Guest pilot** with **Save progress**. The **TICK** chip counts up. There is no wallet, gas, or transaction wording.
2. **Save progress.** Click **Save progress**, then **Continue with Google (mock)**. A popup titled **Google (mock)** opens. Click **test-pilot**. The popup closes. The game page does not reload. The chip now reads **Pilot ID test-pilot.terraagent.mock** and has a **Copy** button. Copy puts `test-pilot.terraagent.mock` on the clipboard (the button shows it copied). For a second or so you may also see **Saving to orbit…**; it fades when the save settles.
3. **Settings → Account** — *not in this landing* (Pilot ID, providers, sessions, Take custody). Skip.
4. **Dev chain.** Open `<client>/dev/chain/` in a second tab. Click **ACCOUNTS**. Within a few seconds you see `test-pilot.terraagent.mock` and a colony account ending in `.test-pilot.terraagent.mock`. Click **RECEIPTS**. A row whose call is `Relayer.submitMetaTx` has a `mock:` hash. Click that hash. The receipt page shows **FINAL**, signer `relayer.terraagent.mock`, and receiver `res.terraagent.mock`. The payload names `storage_deposit` and the colony account. (The colony row in the database is a new `co_…` id, not the sim's `col_0`. That is BE-45.)
5. **Same pilot on a second device** — *not in this landing*. Skip.
6. **Retry when the save fails.** On the game tab, dev console: `near.mock.fail relayer 1`. Open a new browser profile (or a private window) to `<client>/play.html?scenario=w06&as=w06b`. **Save progress → Continue with Google (mock)**, type a name that is not `test-pilot` (for example `relay-guest`) and confirm. The chip becomes **Pilot ID relay-guest.terraagent.mock**, then a toast reads **Couldn't save to orbit, retrying** with **Retry**. Dev console: `near.mock.fail relayer 0`. Click **Retry**. The toast goes away. Leave the fail rate at 0 (`near.mock.fail relayer 0` again if you are unsure).
7. **Wave off.** Open `<client>/play.html?scenario=w06&waves=..05`. There is no **Guest pilot** chip and no **Save progress**. The planet still ticks. Open `<client>/dev/chain/?waves=..05`. The page says **Off** and does not show **MOCK CHAIN EXPLORER**. Guest play on the first URL still works.

## Automated checks (already green on the branch)

After the merge of `main` (W02): `npm run check` (typecheck, lint, structure, `gen:check`) · `npm test` (1568 passed, 1 skipped) · `npm run test:integration` (65 passed) · `npm run test:contract` (16 passed, including identity and relayer) · `npm run test:parity` (1 case, both hosts) · `npm run test:particles` (22 passed) · `npm run build:strict` · `npm run e2e -- --waves ..06 --hack` (26 passed: W00, W01, W02, and W06 `@hack` steps). W01's first step needed the shadow-depth shader to compile (`objectNormal` was undeclared on `MeshDepthMaterial`); that is RN-63, fixed on this branch. `npm run wave -- land 06` re-runs `ci:fast` (`check`, unit tests, build) plus that e2e.

Steps 3 and 5 are `test.skip` in `tests/e2e/w06.spec.ts` (`not in this landing`).

## When you're done

- **All good:** from the main checkout run `npm run wave -- land 06`. It re-runs the gates, merges W06 into `main`, tags `wave-06`, pushes, and removes this worktree and branch.
- **Something is wrong:** tell the wave lead which step and what you saw. It is fixed on this branch before anything lands.
