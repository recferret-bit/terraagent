# Epic TA-15 — Player Page, Achievements, XP & Maps (D-29)

> **Orchestrator:** [`EXECUTION_ORCHESTRATOR.md`](../EXECUTION_ORCHESTRATOR.md) · **Status Board:** [`STATUS.md`](../STATUS.md) · **Hackathon:** [`HACKATHON_CUT.md`](../HACKATHON_CUT.md) D4, D7, D9, D10
> **Spec:** [`docs/game/player-profile-and-achievements-spec.md`](../../game/player-profile-and-achievements-spec.md) (sections §1–§6, acceptance `PA-01..05`) · [`CLIENT.md`](../../spec/CLIENT.md) §8b (minimap, global map) · [`NEAR.md`](../../spec/NEAR.md) §1a (`BadgeNftPort`, mocked) · [`DECISIONS.md`](../../spec/DECISIONS.md) D-24, D-29, D-30
> **Lanes:** `L1` (backend: TA-15.1, 15.2, 15.8; paths `backend/app/src/{progression,api/me}/**`) · `L5` (client: TA-15.3–15.7)

## Overview

Players need a home outside the planet. The epic covers:
- a player page `/me` with identity, level/XP, current and past planets, stats, history, achievements, and the play / matchmaking entry;
- in the game HUD, a minimap and a fullscreen global planet map.

Achievements follow freightchain's rules: frozen ids, append-only unlocks, `progressOf`, catch-up on profile load, and an optional soulbound badge minted through an outbox. They also follow its flip-card ladder, restyled in TerraAgent's **Faction Plate** design system (`frontend/design/css/tokens.css`: `--ta-*`, chamfered plates, no `border-radius`).

## Epic analytics

- **Goal / user value:**
  - A sense of long-term progress across planets.
  - A shareable profile.
  - A map that answers "where is my stuff, where is the threat".
- **Success metrics:**
  - `PA-01..05` green.
  - p95 `/me/profile` < 150 ms with 50 history rows.
  - The minimap redraws in < 2 ms per delta on a mid-range phone.
- **In scope:** progression service and XP, profile API, `/me` UI, achievement cards, badge art generator, minimap, global map, badge mint outbox on the mock `BadgeNftPort`.
- **Out of scope:**
  - Real NEP-171 badge contract (TA-10.4, phase 2).
  - Seasons and leaderboards.
  - Party tickets (TA-05.7; `/me` Play only links to them).
- **Key risks → mitigations:**
  - XP double counting → `XpLedger (playerId, source, sourceId)` unique.
  - Achievement drift → ids frozen; add tiers, never retune.
  - L5 overload → badge art (15.5) is optional; glyph placeholders ship first.

## Task index

| Task | Title | Wave / Lane | Depends On |
|---|---|---|---|
| `TA-15.1` | Progression service: Facts, AchievementUnlock, XpLedger, level curve, evaluation on sim events + catch-up | W3 / L1 | TA-07.7, TA-03.2 |
| `TA-15.2` | Profile API: `/me/profile`, `/me/history`, `/me/achievements` | W3 / L1 | TA-15.1, TA-04.4 |
| `TA-15.6` | Minimap: cached tile canvas, unit dots, camera footprint, click/drag pan, alert pulses | W3 / L5 | TA-11.4, TA-11.5 |
| `TA-15.8` | BadgeMint outbox through `BadgeNftPort` (mock adapter; real in TA-10.4) | W4 / L1 | TA-15.1, TA-10.8 |
| `TA-15.3` | Player page UI `/me`: Pilot, Progress, Planets, Stats, History, Play (Faction Plate) | W4 / L5 | TA-15.2, TA-11.1 |
| `TA-15.4` | Achievement flip cards + tier ladders (20 × 3) | W4 / L5 | TA-15.3 |
| `TA-15.7` | Global planet map: fullscreen overlay, layers, zoom, click-to-fly, shift-click orders | W4 / L5 | TA-15.6 |
| `TA-15.5` | Badge art generator: hex medallion, 3 tier rims + pips, locked steel/padlock variant, contact sheet | W5 / L5 | TA-15.4 |

---

## Tasks

### `TA-15.1` — Progression service: Facts, unlocks, XP

- **Status:** `[ ] Todo`
- **Wave / Lane:** `W3 / L1`
- **Depends On:** `TA-07.7` (in-process sim events, D-24), `TA-03.2`
- **Spec:** profile spec §2, §3, §5
- **Target Files:**
  - `backend/app/src/progression/domain/{achievements.ts,progress.ts,level-curve.ts}`: pure catalogue of 20 families × 3 tiers; `progressOf`; `xpForLevel(L) = 50·L·(L+1)`; cap 30
  - `backend/app/src/progression/application/{facts.service.ts,achievement.service.ts,xp.service.ts}`
  - `backend/app/src/progression/infrastructure/prisma/*.repository.ts`
  - `shared/db/prisma/schema.prisma` (lead pre-step: `PlayerFacts`, `AchievementUnlock`, `XpLedger`, `PlayerXp`)
  - `backend/app/test/progression/{catalogue.spec.ts,evaluate.spec.ts,xp.spec.ts}`
  - `shared/sim/scenarios/achievements-all.ts`
- **Verify:** `npm run test -w @terra/app -- progression`

#### Analytics
- **Problem:** turn sim and lobby events into lifetime facts, unlocks and XP without double counting.
- **Constraints:** catalogue ids frozen; unlocks append-only; XP is cosmetic only.
- **Risk:** event loss on crash → catch-up evaluation from Facts on profile load (freightchain pattern).
- **Telemetry:** `achievement_unlocked{id,tier}`, `xp_awarded{source}`, `level_up{level}`.

#### Architecture
- Sim events (`stageReached`, `buildingCompleted`, `tilePrepared`, `wallRaised`, `raidRepelled`, `tradeSettled`, `cargoExported`, `colonySettled`, …) feed counters into `PlayerFacts`.
- `evaluate(playerId)` inserts any new `AchievementUnlock` rows and the matching `XpLedger` rows in one transaction.

#### Definition of Ready (DoR)
- [ ] Lead pre-step: schema rows above; event kinds in `@terra/contracts`.

#### Definition of Done (DoD)
- [ ] `PA-01`: the `achievements-all` scenario earns every one of the 60 tiers, each adding exactly its listed XP once. Re-running evaluation adds nothing.
- [ ] Level curve matches spec §2 (L1 100, L5 1 500, L10 5 500, L20 21 000, cap 30).
- [ ] Milestone XP (stage first reach, Settled, survived planet end) is idempotent.
- [ ] Status synced in orchestrator, issue file and STATUS.md (§1.6).

---

### `TA-15.2` — Profile API

- **Status:** `[ ] Todo`
- **Wave / Lane:** `W3 / L1`
- **Depends On:** `TA-15.1`, `TA-04.4`
- **Spec:** profile spec §1, §5
- **Target Files:**
  - `backend/app/src/api/me/{profile.controller.ts,history.controller.ts,achievements.controller.ts}`
  - `shared/contracts/src/rest/me.ts` (lead pre-step: `ProfileDto`, `HistoryPageDto`, `AchievementDto`)
  - `backend/app/test/api/me/*.spec.ts`
- **Verify:** `npm run test -w @terra/app -- api/me`

#### Analytics
- **Problem:** one call renders the page. History is paged; achievements carry progress.
- **Telemetry:** request latency histogram per endpoint.

#### Definition of Done (DoD)
- [ ] `GET /me/profile` returns identity, level / XP / title, stats tiles, current and past colonies, and the next 3 achievements; p95 < 150 ms with 50 history rows.
- [ ] `GET /me/history?cursor=` returns pages of 50, filterable by planet and type.
- [ ] `GET /me/achievements` returns 60 tiers with `{earnedAt|null, progress{value,target}, xp, badge{status}}`.
- [ ] Profile load triggers catch-up evaluation.
- [ ] Status synced (§1.6).

---

### `TA-15.6` — Minimap

- **Status:** `[ ] Todo`
- **Wave / Lane:** `W3 / L5`
- **Depends On:** `TA-11.4`, `TA-11.5`
- **Spec:** CLIENT §8b (minimap)
- **Target Files:**
  - `frontend/game/src/hud/map/{Minimap.tsx,tile-canvas.ts,markers.ts}`; hackathon: `src/ui/minimap.ts`
  - `frontend/game/test/hud/map/minimap.test.ts`
- **Verify:** `npm run test -w @terra/game -- minimap`

#### Analytics
- **Problem:** spatial awareness without moving the camera.
- **Constraints:** a cached 2D canvas that repaints tile states only on delta; ≤ 2 ms per update on phones; 180 px desktop, 140 px phone landscape.
- **Telemetry:** `minimap_click`, `minimap_drag`.

#### Definition of Done (DoD)
- [ ] Tile colours by state (Wild terrain class, Prepared, Living, Ridge/Moat, water); territory borders per colony; unit and building dots (own orange, others by colour, fauna red, Guild blue); client-drawn fog; camera trapezoid.
- [ ] Click or tap pans the camera; drag pans continuously; expand icon or `M` opens the global map (TA-15.7).
- [ ] Alerts (`underAttack`, incoming raid, meteor) pulse at their position for 5 s.
- [ ] Status synced (§1.6).

---

### `TA-15.8` — BadgeMint outbox (mock `BadgeNftPort`)

- **Status:** `[ ] Todo`
- **Wave / Lane:** `W4 / L1`
- **Depends On:** `TA-15.1`, `TA-10.8`
- **Spec:** profile spec §3 (optional chain layer), §5; NEAR.md §1a rules 4–6
- **Target Files:**
  - `backend/app/src/progression/application/badge-mint.relay.ts`
  - `backend/app/test/progression/badge-mint.spec.ts`
- **Verify:** `npm run test -w @terra/app -- badge-mint && npm run test -w @terra/app -- near-contract --grep BadgeNft`

#### Analytics
- **Problem:** an earned tier may be recorded as a soulbound badge without blocking gameplay. The mock and the real adapter share one path.
- **Risk:** duplicate mints → `opId = badge:{playerId}:{achievementId}` in `chain_outbox`.

#### Definition of Done (DoD)
- [ ] `PA-05`: with the mock adapter, a badge goes `planned → sent → minted` after the 1 h delay (configurable; 10 s in dev). The card back shows "mock record". With a real adapter it shows the explorer link.
- [ ] A failed mint retries with backoff and ends `failed` after N attempts. A retry never double-mints.
- [ ] Status synced (§1.6).

---

### `TA-15.3` — Player page UI `/me`

- **Status:** `[ ] Todo`
- **Wave / Lane:** `W4 / L5`
- **Depends On:** `TA-15.2`, `TA-11.1`
- **Spec:** profile spec §1, §2; CLAUDE.md UI rules (Faction Plate)
- **Target Files:**
  - `frontend/game/src/pages/me/{MePage.tsx,PilotSection.tsx,ProgressSection.tsx,PlanetsSection.tsx,StatsTiles.tsx,HistorySection.tsx,PlaySection.tsx}`; hackathon: `me.html` + `src/me/*.ts` (add to `vite.config.ts` inputs and link from `index.html`)
  - `frontend/game/src/pages/me/me.css` (`--ta-*` tokens only)
  - `frontend/game/test/pages/me/*.test.tsx`; `tests/e2e/me.spec.ts`
- **Verify:** `npm run test -w @terra/game -- me && npm run test:e2e -- --grep @me`

#### Analytics
- **Problem:** one page answers who I am, how far I've got, where my colonies are, what happened, and how to play next.
- **Constraints:**
  - Server text only via `textContent` / element helpers (no `innerHTML`).
  - `prefers-reduced-motion` respected.
  - Stacks into one column below 560 px.
- **Telemetry:** `me_view{section}`, `me_dive_in`, `me_play_join`.

#### Definition of Done (DoD)
- [ ] Sticky section tabs: PILOT · PROGRESS · PLANETS · HISTORY · ACHIEVEMENTS · PLAY.
- [ ] Level / XP bar and an 11-segment stage track (S0–S10) with the next unlock condition.
- [ ] Stats tiles at `repeat(auto-fit, minmax(130px, 1fr))`.
- [ ] Current planet cards show stage, terraform %, Living n/m, online/away and "Dive in". Past cards show Settled / eliminated / departed.
- [ ] `PA-03`: a lint/test forbids `innerHTML` under `pages/me` and `src/me`.
- [ ] `PA-04`: renders at 360 × 640 portrait (stacked) and in phone landscape without horizontal scroll.
- [ ] Status synced (§1.6).

---

### `TA-15.4` — Achievement flip cards + ladders

- **Status:** `[ ] Todo`
- **Wave / Lane:** `W4 / L5`
- **Depends On:** `TA-15.3`
- **Spec:** profile spec §3, §4
- **Target Files:**
  - `frontend/game/src/pages/me/achievements/{AchievementsSection.tsx,Ladder.tsx,FlipCard.tsx,ProgressBar.tsx}`
  - `frontend/game/src/pages/me/achievements/flip-card.css`
  - `frontend/game/public/img/achievements/glyphs/*.svg` (placeholders until TA-15.5)
  - `frontend/game/test/pages/me/achievements/*.test.tsx`
- **Verify:** `npm run test -w @terra/game -- achievements && npm run test:e2e -- --grep @achievements`

#### Analytics
- **Problem:** 60 tiers must read at a glance, with the next goal obvious and the reward visible.
- **Telemetry:** `achievement_card_flip{id}`, `achievement_share{id}`.

#### Definition of Done (DoD)
- [ ] One ladder per family: eyebrow `h3`, then 3 chamfered cards with scroll-snap.
- [ ] Front: art, name, tier label, and either `✓ date` or a progress bar. Only the next tier shows its description.
- [ ] Back: description, threshold, XP, earned date or progress, badge status.
- [ ] Tier colours `#C8844A` / `#C9CED6` / `#FFCF5A`. Earned: orange→terra gradient border and glow. Locked: steel art.
- [ ] `PA-02`: flip on hover, tap, Enter/Space; `aria-expanded` synced; the front is hidden at 0.38 s; the sheen sweeps; reduced motion crossfades instead.
- [ ] Entry stagger `--i × 70ms`.
- [ ] Status synced (§1.6).

---

### `TA-15.7` — Global planet map

- **Status:** `[ ] Todo`
- **Wave / Lane:** `W4 / L5`
- **Depends On:** `TA-15.6`
- **Spec:** CLIENT §8b (global planet map)
- **Target Files:**
  - `frontend/game/src/hud/map/{GlobalMap.tsx,layers/*.ts,MapLegend.tsx}`; hackathon: `src/ui/global-map.ts`
  - `frontend/game/test/hud/map/global-map.test.ts`
- **Verify:** `npm run test -w @terra/game -- global-map`

#### Analytics
- **Problem:** a planet-wide overview for expansion, threats and markets.
- **Constraints:** 2D canvas, not the 3D scene; redraw ≤ 2 Hz on deltas; wheel and pinch zoom 1×–4×.
- **Telemetry:** `global_map_open{source}`, `global_map_layer_toggle{layer}`.

#### Definition of Done (DoD)
- [ ] Opens with `M` or from the minimap; closes with `Esc`, `M`, or the close plate.
- [ ] Layer chips: Territory · Terrain · Terraform % · Resources · Units · Threats · Market · Walls. The first three plus Units are required; the rest are cut-able.
- [ ] Colony hover cards show name, stage and truce state.
- [ ] Click flies the camera there and closes the map. Shift-click sets a rally point or attack-move for the selection.
- [ ] Status synced (§1.6).

---

### `TA-15.5` — Badge art generator

- **Status:** `[ ] Todo`
- **Wave / Lane:** `W5 / L5` (first in the hackathon cut list; glyphs ship until then)
- **Depends On:** `TA-15.4`
- **Spec:** profile spec §4 (badge art)
- **Target Files:**
  - `frontend/design/achievements/{generate.mjs,glyphs.mjs,preview.html}` (port of freightchain's generator)
  - output `frontend/game/public/img/achievements/{<id>.svg,<id>.png,<id>-locked.svg}`
- **Verify:** `node frontend/design/achievements/generate.mjs && open frontend/design/achievements/preview.html`

#### Definition of Done (DoD)
- [ ] 60 tier medallions + 20 locked variants at 1024², as SVG and PNG.
- [ ] Hex medallion; rim gradient per tier; 3 pips with `tier` lit; Gold gets an outer ring and a glow.
- [ ] One glyph per family (spec §4 list).
- [ ] The contact sheet renders all 80 images.
- [ ] Status synced (§1.6).
