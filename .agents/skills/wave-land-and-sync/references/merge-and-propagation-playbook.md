# Wave Merge, Collision & Future-Wave Propagation Playbook

This reference supplements [`SKILL.md`](../SKILL.md) with concrete collision patterns observed across TerraAgent wave landings (`W00`–`W12`, `W26`) and the domain mapping table for propagating self-review feature extensions into future waves.

---

## 1. Semantic Collision Catalog & Resolution Recipes

| Collision Code | Where It Happens | Why `git merge` Misses It | Resolution Recipe |
| :--- | :--- | :--- | :--- |
| `ECS_ENTITY_KIND` | `shared/sim/src/ecs/columns.ts` (`ENTITY_KIND`), `frontend/game/app/online/entityKinds.ts` (`ARCHETYPE_BY_KIND`) | Two waves add different keys at different lines of `ENTITY_KIND` using the same integer (e.g., `tradeHub: 8` vs `builder: 8`). In `ARCHETYPE_BY_KIND`, the second computed key `[ENTITY_KIND.x]` silently overwrites the first! | Assign the incoming wave's entity kind a new unique integer (`>= 17` or `>= 50`), update any scenario fixtures, and note snapshot version compatibility in `docs/plan/checks/wNN-check.md`. |
| `ECS_ENTITY_STATE` | `shared/sim/src/ecs/columns.ts` (`ENTITY_STATE`) | Two waves append new state codes (e.g., `offlineNoGrid: 14` vs `sieging: 14`). | Renumber the incoming state sequentially after `main`'s highest `ENTITY_STATE` value. |
| `PRISMA_MIGRATION_PREFIX` | `shared/db/prisma/migrations/NNNN_<name>/` | Two waves both create `0009_<feature>/migration.sql`. | Rename the incoming wave's migration directory to the next sequential 4-digit prefix (`0010_<feature>`) and run `npm run gen`. |
| `QL_ENTRY_ID` | `docs/questions-and-limitations/*.md` | Both `main` and the wave branch append `### FF-70` or `### GP-67` to the same area file. | Renumber the wave branch's newly added Q&L entries to follow `main`'s highest number in that file, and update references in `docs/plan/checks/wNN-check.md` and `docs/plan/waves/WNN-*.md`. |
| `DECISION_ID` | `docs/spec/DECISIONS.md` | Both branches add `## D-43`. | Increment the incoming decision ID and update any `(D-NN)` citations in `AGENTS.md`, `CLAUDE.md`, and `PRODUCT_WAVES.md`. |
| `PLAN_INDEX` | `docs/plan/waves/W*.md` | A merged or added issue row has a bare wave dependency (`W03` instead of `W03-01` or `all W03`), a tag-closure violation (`H` depending on `H+` or blank), or wrong column count (`!= 9`). | Run `python3 scripts/plan/index_waves.py` to see the exact file and line, fix the `Deps` or `H` column, and run `python3 scripts/plan/index_waves.py --write`. |
| `UNLANDED_ISSUE_BRANCH` | `issue/WNN-XX` (`../TerraAgent-wt/WNN-XX`) | An issue sub-worktree was created during wave execution and either forgotten or left unmerged before `wave:land`. | Either land it into the wave branch (`npm run wave:issue:land -- WNN-XX`) or, if intentionally deferred, delete the abandoned branch and document the deferral in `WNN-*.md`. |

---

## 2. Cross-Wave Regression Patterns (Iteration 2 Checklist)

1. **Wave Flag Isolation (`TA_WAVES=..Prev` / `?waves=..Prev`):**
   - `npm run e2e -- --waves ..NN` boots the backend with `TA_WAVES=..NN`.
   - Any `W00`–`W(NN-1)` UI component, dev page (`/dev/chain/`, `/dev/parity/`), or HUD widget that calls an endpoint or expects a DOM element owned by a higher wave will fail when tested under `TA_WAVES=..Prev` (e.g., `XC-36`).
   - Always verify that with `?waves=..Prev`, `WNN`'s menus, dock tabs, overlays, and commands are completely absent and earlier wave suites pass.
2. **Vitest `import.meta.glob` Discovery Cache (`XC-34`):**
   - `frontend/game/core/registry/index.ts` discovers client features via `import.meta.glob('../../features/*/index.ts')`.
   - After merging a branch that adds a new directory under `frontend/game/features/`, ensure Vitest picks up the new feature directory.
3. **Shared Gameplay Rules (`D-37`, `D-42`, `SIM-M-01`):**
   - **Building placement (`D-37`):** Never add a second placement validator; extend `evaluatePlacement` in `shared/sim/src/systems/construction/placement.ts` and run `placement-parity.spec.ts`.
   - **Progressive queue payment & storage cap (`D-42`):** Every construction/production order pays progressively through `systems/queue/`; cancel/dismantle refunds clamp at the family storage cap (`ColonyTreasury`).
   - **Solar clock (`D-42`):** Never add a second day/night timer; read `systems/time` (`getPlanetTime`).
   - **Unit movement (`SIM-M-01`):** Only `shared/sim/src/units/movement/locomotion.ts` may write entity `x/y/q/r` during gameplay.

---

## 3. Mapping Self-Review Extensions to Future Waves (Iteration 3)

When a wave `WNN` is extended during self-review, use this matrix to determine which future waves (`docs/plan/waves/W*.md`) need new or updated issues:

| Self-Review Extension Added in `WNN` | Downstream Future Waves to Update | What to Add / Update in Future Wave Plans |
| :--- | :--- | :--- |
| **New or unified building / extractor / generator** (e.g., shared `ResourceExtractor`, Wind override, Capacitor arcs) | `W05` (T2/T3 deposit tier gate), `W08` (`registerGoalExecutor`), `W14` (fortify/siege priorities), `W16` (AI Director MCP tools), `W17` (T2 upgrades), `W24` (mobile touch controls) | Add/update issues so T2/T3 resource unlocks, autonomous goal executors, AI Director building catalogs, and T2 upgrade paths use the new building kind and rules. |
| **New unit / worker capability or dispatch rule** (e.g., crew assist, timed dismantle, supply cap) | `W07` (combat & supply DCA), `W08` (priority sliders), `W09` (away autopilot), `W17` (Multitask T2), `W19` (Multitask T3) | Ensure worker eligibility (`maxBuildTier`, `allowedTerraformOps`), supply accounting, and away-mode dispatch incorporate the new worker behavior. |
| **New UI HUD / Command Dock / Minimap / Selection mechanic** (e.g., 4-digit counters, selection pulse, dock layout, input blocking) | `W04` (Maps & Camera), `W11` (Sector picker), `W12` (`/me` profile links), `W24` (Mobile landscape & touch), `W27` (Globe navigation) | Update layout/z-index/hotkey specs and mobile responsive issues (`W24`) so new HUD elements do not overlap or leak input to the 3D canvas. |
| **New 3D kitbash archetype, animation channel, lighting, or particle preset** | `W05`, `W07`, `W10`, `W14`, `W17`, `W19`, `W21` (visual rows) | Reference the new kitbash helper, cable clearance rule, or particle preset in downstream visual issues so they reuse the shared renderer registry. |
| **New NEAR port, ledger reason, cargo/market rule, or DB table** | `W10` (Cargo), `W13` (Markets), `W15` (Guild & Agents), `W20` (Deed), `W22` (DAO/Bounties), `W23` (Real NEAR phase 2), `W25` (Backups & load test) | Add contract/adapter swap coverage in `W23`, AI simulation coverage in `W13`/`W15`, and backup/migration verification in `W25`. |
| **Deferred `H+` or post-hackathon issue from `WNN`** | The immediate next wave on the same track (or `W25` for bench/pacing/analytics) | Add a dedicated carry-over issue `WMM-XX` in the target wave, list it in `WNN`'s `Deferred:` bullet, and record an `XC-NN` entry in `docs/questions-and-limitations/cross-cutting.md`. |
