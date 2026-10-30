# Owner check guides

Every wave ends with the owner playing its demo story by hand before the wave lands in `main` ([`PRODUCT_WAVES.md`](../PRODUCT_WAVES.md) §7 step 6). The wave lead writes that check as a **step-by-step guide** in this folder, `wNN-check.md`, commits it on the wave branch, and pastes it as its final message. [`w00-check.md`](./w00-check.md) is the worked example.

`npm run wave:check -- NN` prints the guide (or, if there is none yet, the wave file's demo story) with the worktree's real ports.

## Format

1. **Title and one line:** `# WNN — <name>: owner check`, a link to the wave file, the rough duration.
2. **Before you start:**
   - branch and worktree; the main checkout is untouched;
   - the worktree's ports from its `.env.worktree` (app `base+1`, client `base+1173`) and database; define `<client>` / `<app>` once;
   - how to start and stop the stack (`npm run dev`; `kill $(cat .dev/runner.pid)` for a background run);
   - how to reach every tool the steps use: the in-game dev console (`` ` `` key — *not* the browser DevTools console), a second player (`&as=<name>` in another browser profile or tab), the scenario (`?scenario=wNN`), dev pages;
   - a link to [`docs/dev/DEV_TOOLS.md`](../../dev/DEV_TOOLS.md).
3. **Steps:** one numbered step per demo-story step, **same numbers** as the wave file. Each step says:
   - **where:** the exact URL with parameters, the exact terminal command, or the exact menu / panel / button;
   - **how:** the exact console command or click sequence, including any setup (warp, grant, second player);
   - **see:** the exact visible result (text, number, badge, toast, row) and roughly when.
   Steps that are deferred to a later landing say so and are skipped; steps only the automated e2e can check say "(e2e only)" and name the command.
4. **Automated checks:** the gate commands that are already green on the branch (unit, integration, contract, build, the wave e2e and every earlier wave's e2e, parity if the wave adds a scenario).
5. **When you're done:** all good → `npm run wave -- land NN` from the main checkout (re-runs the gates, merges into `main`, tags `wave-NN`, pushes, removes the worktree and branch; plain `npm run wave` does the same and then opens the next ready wave). Something wrong → tell the wave lead which step and what you saw.

## Rules

- Write it from the **running** stack: every URL, command and expected result in the guide was tried by the lead in that worktree before handing over.
- Plain words, short steps, no internal jargon the owner has to look up; if a step needs a key, a tab or a tool, say which.
- When the wave adds a dev tool (URL parameter, console command, dev page, env variable), it is also added to `docs/dev/DEV_TOOLS.md`.

## Open gaps found in the wave demo stories (resolve while writing that wave's guide)

The 2026-10-30 review made every demo step name its URL, console command and visible result. These steps still need something the plan does not define; the wave lead settles them (add the dev command or setup to the wave, or change the step) and records the choice in the guide and `docs/dev/DEV_TOOLS.md`:

| Wave · step | Gap |
|---|---|
| W02 · 5, W03 · 9–10 | Setting an exact or low resource amount (e.g. Minerals < 20): no set-resource command; `grant` is not specified for negative values |
| W03 · 8, W05 · 8, W10 · 8 | `damage <entity> N` needs the entity id: make the selection panel (or the state inspector) show it |
| W06 · 6 | A concrete UI action that triggers a relayed call is not named |
| W08 · 6 | The S3 fauna override name for `stage trigger <override>` is not named (`help stage` lists it once built) |
| W09 · 4 | URL or panel of the mock notifier viewer (W09-20) is not named |
| W16 · 2, 6, 7 | `ai trigger resource.critical` stands in for the old "water drain"; no `AI_MOCK_MODE` that proposes a raid; the away story assumes `away.warp 1` + reload |
| W16 · 5 | The admin `curl` needs auth the plan does not describe |
| W13, W18, W22, W23 (second player) | Join with the link printed by the dev console `planet <name>` (`?join=<planet id>&as=<name>`, W00); the wave's scenario must give each named player its colony (W18 assumes `as=b`, `c`, `d`) |
| W23 · 1–3 | Need real testnet/mainnet credentials (after the H2 gate) |
| W24 · 2–3 | Android orientation lock and iOS standalone need a real device; browser device mode only approximates them |
