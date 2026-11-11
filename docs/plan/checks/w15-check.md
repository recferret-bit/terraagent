# W15 — Guild & Agents: owner check

The demo story in [`waves/W15-guild-agents.md`](../waves/W15-guild-agents.md). About 20 minutes. Visual steps (ship, toast, six offers, a real director sale) are yours to confirm. The server path is covered by `npm run e2e -- tests/e2e/w15.spec.ts` (12 tests passed on this branch before the guide was written). Empty-book and fill gaps are [BE-108](../../questions-and-limitations/backend-contracts.md).

## Before you start

- **Where it runs:** branch `wave/w15-guild-agents`, worktree `../TerraAgent-wt/w15`. Your main checkout is untouched.
- **Ports:** `infra/.env.worktree` sets `TA_PORT_BASE=4100` → app **4101**, client **5273** (`TA_DB_NAME=terra_wave_w15_guild_agents`). Below, `<client>` = `http://127.0.0.1:5273`, `<app>` = `http://127.0.0.1:4101`.
- **Start:** `cd ../TerraAgent-wt/w15 && npm run dev` (Docker running, for Postgres). Stop with Ctrl-C, or `kill $(cat scripts/dev/.out/runner.pid)` if it was started in the background.
- **Dev console:** on the game page press **` `** (the key under Esc). Type there and press Enter. It is not the browser DevTools console.
- **Chain explorer:** `<client>/dev/chain/`.
- Commands and env keys: [`docs/dev/DEV_TOOLS.md`](../../dev/DEV_TOOLS.md). `NEAR_ADAPTER_AGENT_WALLET` defaults to `mock`. `GUILD_ENABLED` and `GUILD_NPC_COUNT` are documented and not read (LED-37). The switch is `TA_WAVES`.

## Steps

1. **Scenario.** Open `<client>/play.html?scenario=w15`. See a colony already on the ground (no orbit menu), a Trade Hub, metals near 1400 / 1500, water near 200. The Trade Hub panel has a **GUILD** tab. Settings → Away has an autoTrade section.
2. **Dock.** Dev console: `guild.summon kestrel`. See `Kestrel docked — N quotes`. The socket gets `guild.arrived`. If N is 0, the book has no reference price yet (LED-38); the Guild tab still opens and can say there are no offers. A toast `Guild trader Kestrel has docked — N offers` sits at the bottom center of the screen, clear of the supply chip. The ship descending is the other visual half (RN-90). Confirm both by eye.
3. **Accept.** If the Guild tab lists an offer, tap **Accept**. See a contract toast, or `Rejected: That Guild offer has expired` if the quote moved. The counterparty account is `guild-1.npc.terraagent.mock` on `<client>/dev/chain/` when a trade actually settles. If the list is empty, this step is the empty-book case in BE-108. Do not treat an empty list as a failed dock.
4. **Price moves after a fill.** Dev console: `guild.setInventory kestrel metals.t1 600` → the command succeeds. A live sell of 600 metals into a Guild bid, and a lower next bid, is the integration spec `guild-requote` (LED-41), not this click, unless the book already showed a metals bid.
5. **Away limits.** Settings → Away. Set metals: sell above 80%, max 300 per trade, max 600 per session, keep at least 200, partner Guild. Save. Reload the page. The same numbers are still there.
6. **Director key.** In that Away section, turn the director key on. See `Allowance 600 · spent 0`.
7. **Away.** Dev console: `away.simulate on`. The colony is away (W09 presence). A director sale of 300 metals and `spent 300 / 600` needs the director sweep to fire while storage is over 80%. The e2e only checks that `away.simulate on` is accepted (BE-108). If you warp and a sale happens, the Away welcome plate should include `Director sold 300 metals to the Guild.`
8. **Back and revoke.** Dev console: `away.simulate off`. Tap **Revoke**. See `Revoked`.
9. **Depart.** Dev console: `guild.depart kestrel`. See `guild.departed` (the ship lifts off if the mesh is on screen). Quotes from that NPC leave the book. A second planet carrying the cargo needs W11 (LED-36, LED-39). With one planet the same inventory is still on the NPC for the next dock.
10. **Kill.** Dev console: `guild.disable kestrel`. See `quotes killed`. Cash-budget exhaustion and the stress replay stay in `guild-funding` and `guild-stress` tests (LED-44), not this click.
11. **Flag off.** Stop the stack. Start it again with waves through 14 only: `TA_WAVES=..14 npm run dev`. Reload `<client>/play.html?scenario=w15`. See no Guild tab and no Away autoTrade section. A W13 market command such as setting a hub fee is not rejected as `wave_disabled`. Restore with a normal `npm run dev` afterward.

## Automated checks

Pre-landing run on 2026-11-11, from this worktree:

- `npm run ci:fast` passed (765 test files, structure check, build).
- `npm run test:parity`, `npm run test:contract`, `npm run validate:models -- --all`, and `npm run validate:particles -- --all` passed.
- `npm run validate:wave -- 15` passed with one warning: owned-path drift (the wave hooks W09 digest, W13 orders, and contracts outside the declared owned paths).
- `npm run test:integration` was 523 passed and 4 failed. The failures are outbox relay timing and one deed version bump. Those two files passed when run alone. See [BE-109](../../questions-and-limitations/backend-contracts.md).
- `tests/e2e/w15.spec.ts` passed all 12, twice. `npm run e2e -- --waves ..15 --hack` was 83 passed, 5 failed, 64 not run. The five are earlier waves (BE-109). The W15 file is not one of them.

Before land, from this worktree, still worth a quiet re-run:

`npm run test:integration` · `npm run e2e -- --waves ..15 --hack`

`npm run wave -- land 15` runs `ci:fast` again. It does not run the full e2e unless you pass the wave number the way the land script expects.

## When you're done

- **All good:** from the main checkout run `npm run wave -- land 15`. It merges this branch into `main`, tags `wave-15`, pushes, and removes this worktree and branch.
- **Something is wrong:** tell the wave lead which step and what you saw. It is fixed on `wave/w15-guild-agents` before anything lands.
