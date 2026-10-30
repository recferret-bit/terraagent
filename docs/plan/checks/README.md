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
