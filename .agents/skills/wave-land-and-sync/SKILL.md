---
name: wave-land-and-sync
description: >-
  Carefully land an implemented wave into `main` (Mode 1: `land` / "merge wave into main" / "land wave into main")
  or merge an updated `main` into a Work-In-Progress wave branch (Mode 2: `sync` / `merge-main` / "merge main into wave" /
  "sync main into wave"). Runs a mandatory 3-iteration merge, semantic-collision audit, test, and gap-discovery loop,
  auto-heals generated registry/schema conflicts, updates canonical root docs (`README.md`, `HACKATHON.md`, `infra/.env.example`,
  `frontend/whitepaper/whitepaper.md`), and propagates new self-review features into downstream wave plans when present. Activate
  this skill immediately whenever the user says "merge wave into main", "land wave into main", "merge main into wave",
  "sync main into wave", or asks to land a wave, sync `main` into an open wave worktree, resolve cross-wave merge conflicts,
  or update future wave plans after self-review extensions.
---

# Wave Land & Sync Harness (`wave-land-and-sync`)

> **Clean Root Note (`D-41`):** On `main`, canonical documentation lives in [`README.md`](../../../README.md), [`HACKATHON.md`](../../../HACKATHON.md), [`infra/.env.example`](../../../infra/.env.example), [`frontend/whitepaper/whitepaper.md`](../../../frontend/whitepaper/whitepaper.md), and [`shared/sim/README.md`](../../../shared/sim/README.md) (no `docs/` folder at repo root). Any `docs/plan/*` steps below apply only when syncing or landing legacy wave worktrees that still carry `docs/plan/`.

In TerraAgent, every product wave (`W00`–`W27`) is developed in an isolated git worktree (`../TerraAgent-wt/wNN` on branch `wave/wNN-<slug>`) and extended during owner self-review. Because waves run across parallel tracks and share registries, ECS columns, data tables, placement rules, and progression contracts, merging a wave into `main`—or merging an updated `main` into a WIP wave—requires more than `git merge`:

1. **Auto-generated barrels and schemas collide** (`index.generated.ts`, `contracts.schema.json`, `schema.prisma`, `ISSUE_INDEX.md`, `HACKATHON_SCHEDULE.md`).
2. **Silent semantic collisions happen without git conflict markers** (duplicate `ENTITY_KIND` / `ENTITY_STATE` numeric codes, duplicate Prisma migration prefixes, duplicate `docs/questions-and-limitations/` entry IDs, duplicate `DECISIONS.md` numbers, or wave-flag leaks breaking earlier waves' E2Es under `TA_WAVES=..NN`).
3. **Self-review extends every wave with new features**, which must be audited and propagated into **future waves and plan documents** (`docs/plan/waves/W*.md`, `PRODUCT_WAVES.md`, `DEV_TOOLS.md`, `DECISIONS.md`) after landing so downstream waves build on the actual as-built architecture.

---

## 0. Natural-Language Agent Triggers ("Do All The Heavy Work")

When the user gives a short natural-language prompt such as:
- **"merge wave into main"** / **"land wave into main"** / **"land W07"** $\rightarrow$ **Mode 1 (`land`)**
- **"merge main into wave"** / **"sync main into wave"** / **"update wave with main"** $\rightarrow$ **Mode 2 (`sync` / `merge-main`)**

You MUST do **all the heavy work autonomously end-to-end** without asking the user to run manual steps:

1. **Auto-Resolve Target Wave (`WNN`):**
   - If the user named a wave (e.g. `W07` or `07`), use that wave.
   - If the user did **not** specify a wave number, detect it automatically:
     1. Check the current working directory branch (`git rev-parse --abbrev-ref HEAD`) — if on `wave/wNN-<slug>` or `issue/WNN-XX`, target `WNN`.
     2. Otherwise run `npm run wave -- status` to inspect open worktrees in `../TerraAgent-wt/wNN`:
        - For **"merge wave into main"**: pick the open wave whose issues are complete (`done == total`) and whose dependencies are all `landed` on `main`.
        - For **"merge main into wave"**: if one WIP wave is open, sync it; if multiple WIP waves are open (`../TerraAgent-wt/w*`), sync all of them (`npm run wave:sync -- --all --sync-issues`) or the one the user was just discussing.
2. **Execute Full End-to-End Pipeline & Fix Every Issue:**
   - Run the harness (`npm run wave:audit -- <NN>`, `npm run wave:land -- <NN>` or `npm run wave:sync -- <NN> --sync-issues`).
   - If any git conflict, semantic collision, structure limit violation (`>500` lines / `>100` lines per function), 3D model/particle validation error, unit/parity/contract test, or Playwright E2E fails during any of the **3 iterations**, **fix the root cause in code/docs immediately**, commit the fix on the branch, and re-run until all 3 iterations pass 100%.
   - **After Mode 1 (`land`) merges into `main`**: immediately run `npm run wave:propagate -- <NN>`, inspect all self-review commits and undocumented feature extensions, update `docs/plan/waves/WNN-*.md`, `docs/plan/PRODUCT_WAVES.md`, `docs/dev/DEV_TOOLS.md`, `docs/spec/DECISIONS.md`, `docs/questions-and-limitations/*.md`, and **inject new/updated feature integration issues into downstream future wave plans (`docs/plan/waves/W*.md`)**, regenerate `python3 scripts/plan/index_waves.py --write`, verify `npm run ci:fast` on `main`, and commit + push the future-wave plan updates.

---

## 1. Two Operating Modes & CLI Harness

| Mode | Command | When to Use | What It Does |
| :--- | :--- | :--- | :--- |
| **Mode 1: Land Wave into `main`** | `npm run wave:land -- <NN>`<br>`node .agents/skills/wave-land-and-sync/scripts/wave-harness.mjs land <NN>` | Wave `WNN` is implemented and reviewed in `../TerraAgent-wt/wNN` and ready to land on `main`. | 1. Checks dependencies & worktree cleanliness.<br>2. Merges latest `main` into `wave/wNN-<slug>` with generated-file auto-heal.<br>3. Runs **3 iterations** (Semantic Audit → Full Gates → As-Built & Plan Check).<br>4. Merges `--no-ff` into `main`, tags `wave-NN` (or `wave-NN.K`), pushes, cleans up worktree/branch.<br>5. Audits self-review feature extensions and updates future waves (`W(NN+1)..W27`). |
| **Mode 2: Merge `main` into WIP Wave** | `npm run wave:sync -- <NN>`<br>`npm run wave:sync -- --all`<br>`node .agents/skills/wave-land-and-sync/scripts/wave-harness.mjs sync <NN>` | `main` has advanced (another wave landed or plans were updated) while `WNN` is still WIP in `../TerraAgent-wt/wNN`. | 1. Saves recovery ref `refs/wave-sync-backup/WNN`.<br>2. Merges `main` into `wave/wNN-<slug>` with generated-file auto-heal.<br>3. Runs **3 iterations** (Semantic & Registry Reconciliation → WIP Gates → Incoming `main` Plan Delta).<br>4. Optionally merges updated `wave/wNN-<slug>` into open `issue/WNN-XX` sub-worktrees (`--sync-issues`).<br>5. Reports new/modified `WNN-XX` issues added to `WNN` on `main`. |
| **Audit & Gap Discovery** | `npm run wave:audit -- <NN> [--sync] [--json]` | Before or after merging, to inspect collisions, unlanded issue branches, and as-built feature deltas. | Scans ECS codes, migrations, Q&L IDs, Decision IDs, plan DAG problems, self-review commits, undocumented extensions, and impacted future waves. |
| **Future-Wave Plan Propagation** | `npm run wave:propagate -- <NN>`<br>`npm run wave:propagate -- <NN> --add-issue <WMM> --title "..." ...` | After (or right before) landing `WNN`, to propagate new self-review features into future waves. | Lists all impacted downstream waves (`W(NN+1)..W27`) with their next available issue IDs (`WMM-XX`) and safely injects new issue rows before `Wave e2e`, validating with `index_waves.py --write`. |

---

## 2. Mandatory 3-Iteration Protocol (Both Modes)

Never treat a merge as a single pass. Every fix in Iteration 1 can expose a test or flag-isolation failure in Iteration 2, and every fix in Iteration 2 can shift the as-built scope or line limits in Iteration 3.

### Iteration 1 — Merge Reconciliation, Codegen Auto-Heal & Semantic Collision Pass

1. **Git Merge & Generated File Auto-Heal:**
   - When `main` and `wave/wNN-<slug>` conflict on generated files (`shared/contracts/src/{commands,events}/index.generated.ts`, `shared/contracts/schema/contracts.schema.json`, `shared/db/prisma/schema.prisma`, `shared/sim/src/{data,systems}/index.generated.ts`, `tests/scenarios/{,parity/}index.generated.ts`, `docs/plan/{ISSUE_INDEX,HACKATHON_SCHEDULE}.md`), never resolve them by hand.
   - `mergeWithAutoHeal` checks out `--ours`, runs `npm run gen` and `python3 scripts/plan/index_waves.py --write`, and stages the freshly generated outputs.
   - Resolve any remaining source or markdown conflicts by preserving **both** waves' registrations, rules, and handoff contracts.
2. **Semantic Collision Scan (`npm run wave:audit -- <NN>`):**
   - **`ECS_ENTITY_KIND` / `ECS_ENTITY_STATE`** (`shared/sim/src/ecs/columns.ts`, `frontend/game/app/online/entityKinds.ts`): Verify no two distinct entities or states share a numeric ID. If two waves picked the same numeric code (e.g., `8`), move the newly added one to the next free code and update any scenario/snapshot fixtures.
   - **`PRISMA_MIGRATION_PREFIX`** (`shared/db/prisma/migrations/`): Verify no two migration folders share a 4-digit prefix (e.g., `0009_*`). Renumber the newer wave's migration folder if needed.
   - **`QL_ENTRY_ID`** (`docs/questions-and-limitations/*.md`): Verify no two entries share an ID (`### GP-67`, `### FF-70`, `### XC-35`). Renumber the incoming branch's new entries sequentially after `main`'s highest ID in that file.
   - **`DECISION_ID`** (`docs/spec/DECISIONS.md`): Verify `## D-NN` headings are strictly sequential with no duplicates.
   - **`UNLANDED_ISSUE_BRANCH`**: Check that no `issue/WNN-XX` branch or `../TerraAgent-wt/WNN-XX` worktree was accidentally left unmerged (in Mode 1 `land`, merge or explicitly defer it first; in Mode 2 `sync`, pass `--sync-issues` to bring active issue worktrees up to date).
3. **Architecture & 3D Asset Validation:**
   - Run `npm run check` (`typecheck` + `lint` + `check:structure` + `gen:check`). Fix any file > 500 lines or function > 100 lines by extracting helpers, never by compressing lines.
   - If any 3D archetype or particle file changed (`frontend/render/kitbash/**`, `frontend/render/particles/**`), run:
     ```bash
     npm run validate:models -- --all --quiet && npm run test:models
     npm run validate:particles -- --all --quiet && npm run test:particles
     ```

### Iteration 2 — Deep Test, Cross-Wave Regression & Flag-Isolation Pass

1. **Fast CI, Parity & Contract Suites:**
   ```bash
   npm run ci:fast
   npm run test:contract
   npm run test:parity
   ```
   *(If Vitest's module cache retains a stale `import.meta.glob` for newly merged `frontend/game/features/*/index.ts` directories, see `XC-34`.)*
2. **Wave Flag Isolation Audit (`TA_WAVES=..Prev` / `?waves=..Prev`):**
   - Every new data row, command, sim system, HUD panel, Dock button, and backend route introduced by `WNN` MUST check `flags.has('WNN')` (or carry `wave: 'WNN'` in data tables).
   - Never let a `W00`–`W(NN-1)` screen or dev page unconditionally call a `WNN`-gated endpoint (see `XC-36`).
3. **Cross-Wave Gameplay Interaction Audit & E2E (`npm run e2e -- --waves ..NN --hack`):**
   - Check how `WNN`'s mechanics interact with already-landed waves:
     - **Placement (`D-37`):** Does every new building go through `evaluatePlacement` in `shared/sim/src/systems/construction/placement.ts`?
     - **Economy & Queue (`D-42`):** Do orders pay progressively through `systems/queue/`, clamp refunds at storage cap, and derive day/night from `systems/time`?
     - **Progression (`W08-PROGRESSION-CONTRACT.md`):** Does `WNN` register its stage goal executors via `registerGoalExecutor` and respond to HQ priority sliders?
     - **Counter formatting / Power reserves:** If `WNN` changed stock counter formatting (e.g., 4-digit `0500 / 0500`) or night power buffers (e.g., HQ cell reserve before brownout), verify earlier wave E2E assertions (`w01.spec.ts`, `w02.spec.ts`, `w10.spec.ts`) still pass!

### Iteration 3 — As-Built Scope Delta, Gap Documentation & Future-Wave Plan Propagation

Because waves are actively extended during self-review and owner feedback, the code that lands on `main` often contains **new features, new buildings/units, new UI mechanics, new dev tools, and new architectural rules** beyond the initial wave file.

Run the propagation analyzer (works both pre-merge on `wave/wNN-<slug>` and post-merge on `main` via tag `wave-NN^1...wave-NN^2`):
```bash
npm run wave:propagate -- <NN>
```

#### In Mode 1 (After / During Landing `WNN` into `main`):

1. **Update `WNN`'s Own Plan & Reference Docs:**
   - Update `docs/plan/waves/WNN-<slug>.md` (Goal, Demo story, Owned paths, Features covered, Issues table, and Hackathon slice `Deferred:` list) and `docs/plan/PRODUCT_WAVES.md` (§2 table row for `WNN`) to match what was actually built during the wave and its self-review.
   - Add every new URL parameter, dev console command, debug handle, dev route, or env variable to `docs/dev/DEV_TOOLS.md`.
   - Record any new cross-wave architectural rule in `docs/spec/DECISIONS.md` (`D-NN`).
   - Record every deferred issue, intentional trade-off, or open owner question in `docs/questions-and-limitations/<area>.md` (`GP-NN`, `FF-NN`, `XC-NN`, etc.), and mark any resolved entries as `Resolved (<commit/wave-NN>)`.
2. **Propagate New Features into Downstream Future Waves (`docs/plan/waves/W*.md`):**
   - Inspect every downstream wave listed under `Downstream Future Waves to Review & Update` in `npm run wave:propagate -- <NN>`.
   - Ask for each self-review extension added in `WNN`:
     - *Did `WNN` add or change a building, unit, resource, deposit, or terrain op?* → Update downstream Gameplay/Autonomy waves (`W05`, `W07`, `W08`, `W14`, `W16`, `W17`, `W19`, `W21`) so their placement rules, T2 upgrades, AI director tools, and goal executors support it.
     - *Did `WNN` add a new HUD panel, overlay, dock tab, or selection behavior?* → Update Client/Meta waves (`W04`, `W11`, `W12`, `W24` mobile layout, `W27` globe zoom) to integrate with it.
     - *Did `WNN` add or modify a NEAR port, ledger reason, or market/cargo mechanic?* → Update Economy/NEAR waves (`W10`, `W13`, `W15`, `W20`, `W22`, `W23` real NEAR adapter swap).
     - *Did `WNN` defer any `H+` or post-hackathon items?* → Add or update the owning issue in the target future wave (`WMM-XX`) and link it from `WNN`'s `Deferred:` bullet and `XC-NN` entry.
   - Use the safe issue injector to add new issues to future waves (inserts before the wave's `Wave e2e` row and runs `index_waves.py --write` automatically):
     ```bash
     npm run wave:propagate -- <NN> \
       --add-issue W05 \
       --title "Integrate W03 shared ResourceExtractor and wind override hooks into terrain tier unlock" \
       --type sim \
       --size S \
       --tag H \
       --deps "W05-01, W03-11" \
       --accept "Place ResourceExtractor on T2 deposit after terraforming → see T2 yield" \
       --spec "D-34, W03 handoff"
     ```
3. **Validate & Regenerate the Master Plan Index:**
   ```bash
   python3 scripts/plan/index_waves.py --write
   npm run ci:fast
   ```
   Verify `problems 0` in `index_waves.py` (no tag-closure violations where an `H` issue depends on `H+` or blank, no bare wave deps like `W03` instead of `W03-01` or `all W03`, and `ISSUE_INDEX.md` + `HACKATHON_SCHEDULE.md` cleanly regenerated).

#### In Mode 2 (After Syncing Updated `main` into WIP Wave `WNN`):

1. **Absorb Incoming Plan Updates (`delta.incomingMain`):**
   - Review `addedIssuesOnMain` and `modifiedIssuesOnMain` reported by `npm run wave:sync -- <NN>`.
   - These are new issues or updated acceptance checks added to `docs/plan/waves/WNN-*.md` when earlier waves landed and propagated their self-review features!
2. **Sync Active Issue Worktrees:**
   - If subagents or issue worktrees `../TerraAgent-wt/WNN-XX` are open, run:
     ```bash
     npm run wave:sync -- <NN> --sync-issues
     ```
3. **Re-run Fast Gates in the WIP Worktree:**
   - Ensure `npm run ci:fast` passes in `../TerraAgent-wt/wNN` before resuming issue execution.

---

## 3. Reference Documentation & Self-Test

- Detailed checklist of collision patterns, resolution recipes, and future-wave propagation rules: [references/merge-and-propagation-playbook.md](./references/merge-and-propagation-playbook.md)
- Standalone CLI harness: `node .agents/skills/wave-land-and-sync/scripts/wave-harness.mjs`
- Self-test suite (runs in an isolated throwaway git sandbox):
  ```bash
  node .agents/skills/wave-land-and-sync/scripts/self-test.mjs
  npm run test:wave
  ```
