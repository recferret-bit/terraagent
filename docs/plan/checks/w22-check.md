# W22 — Treasury & Bounties: owner check

> The wave's demo story ([`waves/W22-treasury-bounties.md`](../waves/W22-treasury-bounties.md)) as a hands-on checklist. Format and rules: [`README.md`](./README.md). About 20 minutes.
>
> Proposed defaults kept in the data tables (owner can still change them): council costs **1500 / 1000 / 800** `metals.t1` for meteor shield (6 h, −75%), terraform boost (12 h, −25%), and guild subsidy (1 visit); vote window **6 h** and pass at **> 50%** or **≥ 2 yes and 0 no**; mercenary light/reserve **100** `metals.t1` per hour (4 recon), heavy **200** (6 recon), funding cap **10000**. Q-05-15 stays "both": the player max spend is the mercenary cap, and the away session percent does not block the hire because it is defense (BE-90).

## Before you start

- **Where it runs:** branch `wave/w22-treasury-bounties`, worktree `../TerraAgent-wt/w22`. Your main checkout is untouched. `main` was already an ancestor of this branch when the guide was written (nothing new to merge).
- **Ports:** this worktree's `infra/.env.worktree` sets `TA_PORT_BASE=4300` → app **4301**, client **5473** (`TA_DB_NAME=terra_wave_w22_treasury_bounties`). Below, `<client>` = `http://127.0.0.1:5473`, `<app>` = `http://127.0.0.1:4301`. The Playwright stack uses the next ports, **4302** and **5474**, so it can run beside `npm run dev`.
- **Port clash seen on 2026-11-11:** 4301 and 5473 were already held by the `w13` worktree. This check did not stop that process. If `npm run dev` here fails to bind, stop the other worktree's stack first, then start this one.
- **Start the stack** (if it isn't running): `cd ../TerraAgent-wt/w22 && npm run dev` (Docker must be running for Postgres). Stop it with Ctrl-C, or `kill $(cat scripts/dev/.out/runner.pid)` if it was started in the background.
- **Dev console:** in the game page press **`` ` ``** (the key under Esc). A dark panel opens at the bottom; type commands there and press Enter. It is **not** the browser's DevTools console. Click the game first if DevTools has focus.
- **Second colony:** dev console `planet` prints `planet pl_…`. Open that id in another browser profile as `<client>/play.html?join=<planet id>&as=w22b&skip=1`.
- **Seat yourself** as colony A with `<client>/play.html?scenario=w22&skip=1&as=w22a` so the cargo account is `dev:w22a`.
- Every tool used below is described in [`docs/dev/DEV_TOOLS.md`](../../dev/DEV_TOOLS.md).

## Steps

1. **Council opens on the seeded fee history.** Open `<client>/play.html?scenario=w22&skip=1&as=w22a`. Dismiss any stage toast. Click **Planet** (top of the HUD) → **Council**. See balance **4000**, **2 members**, and **No proposals**. The two colonies are Treasury Spire and Bounty Reach. The 4000 is fee history deposited by the server when the scenario loads. It is not taken from your cargo. Your orbital cargo is **1000** `metals.t1` (`GET /v1/near/cargo` with `Authorization: Bearer dev:w22a`).
2. **Fund the treasury.** Dev console (`` ` ``): `planet` to copy the planet id, then `treasury.fund <planet id> 500`. The reply names `metals.t1 500` and the new balance **4500**. Close the console (`` ` `` again). Planet → Council shows **4500**. The funder account is not debited.
3. **Meteor shield.** Planet → Council. In the project list choose **Meteor shield · 1500**, click the propose button, then **Yes** on the open proposal. In the second browser (colony B, `as=w22b`) open Planet → Council and click **Yes** on the same proposal. The first page shows the shield badge (`effect-badge-meteor_shield`) and a timer. Two yes votes and no no votes pass the proposal. The −75% strike rate is **(e2e only)**; you will not see a crater. Dev console `treasury.effect meteor_shield` shows the same badge without a vote.
   - **Hack copy of this step:** propose **Terraform boost · 1000** instead. The badge is `effect-badge-terraform_boost`. `npm run e2e -- --waves 22 --hack` runs this copy, not the meteor shield.
4. **Post a clear-nest bounty.** The black-ant hive is at tile `(18, 0)` and is already spotted. Its entity id is on the replica (the e2e reads kind 63). Planet → **Bounties**. Target **clear nest**, nest id of that hive, reward **200**, expiry **2** hours. Post. The row shows an escrow receipt linking to `/dev/chain/`, and colony A's orbital metals drop from 1000 to **800** (or from whatever they were, by 200).
5. **Claim and pay.** On colony B's Bounties sheet, click **Claim** on that row. The state word becomes **Claimed**. On colony A's dev console run `bounty.complete <bounty id>`. Colony B's orbital metals rise by **200** once. A second `bounty.complete` does not pay again. Both boards show **Paid**. Destroying the nest in the world is not required for this step; the console completion is the path the demo allows. **(The live nest fight is e2e-optional.)**
6. **Hire a squad.** Planet → Bounties. Target **defend area**, tile `0,0`, radius **2**, duration **2** hours, reward **200**, expiry **2**. Post. Cargo drops by another 200. Dev console `merc.hire 2`. The reply contains `escrow` and `merc-1.npc.terraagent.mock`, and a bounty id `bt_…`. Within a few seconds **4** recon units with owner −2 stand on your territory, and cargo drops by another **200** (100 per hour × 2). `merc.hire` now opens the hire escrow (BE-86, resolved).
7. **Expire the player bounty, not the mercenary.** Dev console `bounty.expire <defend bounty id>` (the player row from step 6, not the `merc.hire` id). The reply says `Expired` and `refunded`. Colony A's cargo is restored by **200**. A second `bounty.expire` on the same id says `not refunded` and does not pay again. `bounty.expire <merc bounty id>` says `mercenary` and does not refund that hold. The board word for the player row is **Expired**; the mercenary row stays **Claimed**. Sim `warp` does **not** move the bounty deadline. The deadline is wall-clock `expiresAt` (BE-92).
8. **Flag off.** Open `<client>/play.html?scenario=w22&skip=1&waves=..21&as=w22off`. **Planet** has no Council and no Bounties. Dev console `flags` does not list `W22`. `treasury.fund <planet> 1` prints `unknown command` (the client hides it). This check does not restart the server, so it is not an HTTP 404, and it does not re-settle a W13 trade. A trade with the server booted at `TA_WAVES=..21` takes no treasury share; that half is **(e2e only)** if you restart with `TA_WAVES=..21`.

## Automated checks

Already green on the issue branch before this guide, and re-run on the merged branch by the lead:

- `npm run validate:wave -- 22` → 38/38 issues, 0 errors. Remaining warnings are the missing guide (this file) and pre-existing near-limit modules (XC-48).
- `npm run e2e -- --waves 22` → **9 passed** (5.6 min) on the merged branch, ports **4302** / **5474**. One earlier run lost the `bounty.complete` reply to a 30 s console wait while the board already said Paid. Those waits are 60 s now.
- `npm run e2e -- --waves 22 --hack` runs steps 1, 2, 3 (terraform boost), 4, 5, and 8 only.
- Unit and integration specs named in the wave commits (council, bounty board, expiry, away hire, telemetry, treasury-bounty-edges, dev console). The full `npm run validate:wave -- 22 --gates` and `npm run e2e -- --waves ..22` are the pre-landing gate, not a click in this guide.

`?host=local&scenario=w22` is not what the Playwright file drives (`serverOnly` skips it). Chain council, escrow, and cargo need the server.

## When you're done

- **All good:** from the main checkout run `npm run wave -- land 22`. It re-runs the gates, merges W22 into `main`, tags `wave-22`, pushes, and removes this worktree and branch. (Plain `npm run wave` does the same and then opens the next ready wave.)
- **Something is wrong:** tell the wave lead which step and what you saw. It is fixed on the wave branch before anything lands.
