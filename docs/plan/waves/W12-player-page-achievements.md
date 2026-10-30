# W12 — Player Page & Achievements

> **Track:** Meta (M) · **Flag:** `W12` · **Tag:** `wave-12` · **Scenario:** `scenarios/w12-profile.ts` · **E2E:** `e2e/w12.spec.ts`
> **Depends on waves:** W01 (spine). The Play section reuses W11 if it is on. Achievement families light up as their producer waves land: W01, W02, W03, W05, W07, W08, W13, W14, W15, W18, W21. Families whose producer wave is off show **"coming soon"**.
> **Specs:** [player-profile-and-achievements-spec.md](../../game/player-profile-and-achievements-spec.md) §1–§6 (`PA-01..05`) · [NEAR](../../spec/NEAR.md) §1a (`BadgeNftPort`) · freightchain references (catalogue, flip CSS, profile) · [`frontend/design/css/tokens.css`](../../../frontend/design/css/tokens.css) (Faction Plate) · D-29, D-30
> **Owned paths:** `backend/app/src/progression/**` (except `stage-*`, W08), `backend/app/src/profile/**`, `prisma/progression.prisma`, `shared/contracts/src/{progression,profile}/`, `frontend/game/pages/me/**`, `frontend/me.html`, `frontend/game/features/{achievements,xp}/`, `frontend/design/achievements/**`, `frontend/public/img/achievements/`
> **Where `/me` lives:** a page of the **game app** (not a new app): code in `frontend/game/pages/me/`, so it reuses the game's auth session, `net/` client and the W11 picker components (an app never imports another app). It is served by its own light entry `frontend/me.html` (URL `/me.html` locally; CLIENT's `/me` route in production) without the 3D engine bundle; the lead pre-step adds it to `rollupOptions.input` in `vite.config.ts` and links it from `frontend/index.html`. Styling uses the existing Faction Plate files `frontend/design/css/tokens.css` + `base.css` (`--ta-*` tokens, chamfered plates, no `border-radius`, void text on orange).

## Goal

Players have a home outside the planet. The `/me` page shows who they are (pilot, level, title), what they have built (stats, planets, history) and what is next (stage track, closest achievements). It shows **20 achievement families × 3 tiers** as freightchain-style flip cards in Faction Plate style. XP is cosmetic only and idempotent. Earned tiers can be minted as soulbound badges through the mock `BadgeNftPort`.

## Demo story (e2e)

1. Load `?scenario=w12` (a pilot with 2 past colonies, a live colony at S4 and some facts) → open `/me.html` → see the sticky tabs **PILOT · PROGRESS · PLANETS · HISTORY · ACHIEVEMENTS · PLAY**.
2. Pilot: name, Pilot ID, "pilot since", level 4 badge, XP bar 1 120 / 1 500, title "Surveyor".
3. Progress: the stage track shows `unlockStage` S4, the next 3 closest achievements show progress bars, and the stats tiles show colonies, tiles prepared, Living tiles and more.
4. Planets: one current colony card with **Dive in**, and past cards for an eliminated colony and a Settled colony (Settled only if W21 is on).
5. History: filter by planet → the timeline shows only that planet's rows; scroll → the next page loads.
6. Achievements: the header reads "ACHIEVEMENTS · 9 / 60". Hover a card → it flips (sheen); press Tab + Enter → it flips with `aria-expanded=true`; with reduced motion → it crossfades.
7. Dev console `fact add groundbreaker 900` → the Groundbreaker Silver card turns earned within 1 s; XP +150 once; a level-up toast if the threshold is crossed. Run the same command again → no second XP.
8. The card back shows "Badge minting…", then "Recorded (mock)" after the outbox runs (1 h delay, warped).
9. Cards of families whose producer wave is off (e.g. Warlord with `TA_WAVES=..12`) show "Coming soon".
10. Set `TA_WAVES=..11` → no `/me` link in the game, and `/me.html` shows a "Player page is off" plate (`/v1/me/profile` → `wave_disabled`); the game is unaffected.

## Hackathon slice

> Column `H`: **H** must for Nov 1–14 · **H+** stretch · **H2** real NEAR after the D10 gate · blank = after the hackathon. Plan and calendar: [`HACKATHON_CUT.md`](../HACKATHON_CUT.md), [`HACKATHON_SCHEDULE.md`](../HACKATHON_SCHEDULE.md).

- **The hackathon e2e covers demo steps:** 1, 2, 3, 6, 7, 9, 10. `W12-32` tags these steps `@hack`; `npm run e2e -- --hack` runs only them, and the other steps run once their rows land.
- **Deferred:** Planets cards (step 4), History (step 5), badge minting on the card back (step 8), titles and frames, catch-up evaluation.
- **Still true:** with `TA_WAVES` below this wave the app behaves exactly as the previous wave's tag.

## Features covered

| # | Spec item | Issues |
|---|---|---|
| 1 | Catalogue: 20 families × 3 tiers, frozen ids (tier 1 = family id, then `-2`, `-3`), thresholds, XP, ★ families, glyph, producer wave | W12-01 |
| 2 | Progression event contract (counter / max), `Facts` aggregate | W12-01, W12-02 |
| 3 | `AchievementUnlock` append-only, `progressOf`, `evaluate()` on events | W12-03 |
| 4 | Catch-up evaluation when the profile loads | W12-04 |
| 5 | `XpLedger` idempotent per `(source, sourceId)`; `PlayerXp`; level curve `50·L·(L+1)`, cap 30 | W12-05 |
| 6 | Milestone XP: first stage reach `10 × n`, settled 500, planet survived 200 | W12-06 |
| 7 | Titles and avatar frames per level; level-10 nameplate colour; level-30 gold border | W12-07 |
| 8 | Family availability by wave flag ("coming soon") | W12-08 |
| 9 | `GET /me/profile`, `/me/history?cursor=`, `/me/achievements` | W12-09, W12-11, W12-12 |
| 10 | History event writer (founded, stage, Hub upgrade, raid, nest, truce, trade, rocket, settled, eliminated, achievement) | W12-10 |
| 11 | `/me` page shell: sticky tabs, Faction Plate, 560 px stacking, `textContent`-only rendering | W12-13 |
| 12 | Pilot, Progress, Stats, Planets, History, Play sections | W12-14 … W12-19 |
| 13 | Achievement ladders, family blocks, header count | W12-20 |
| 14 | Flip card: hover/tap/keyboard, `aria-expanded`, `preserve-3d`, mid-flip visibility, sheen, reduced motion, entry stagger | W12-21 |
| 15 | Card states: locked / next tier / earned, tier colours, progress bar, back face, share to X | W12-22 |
| 16 | Badge art generator: hex medallion, tier rims, pips, Gold outer ring + glow, 20 glyphs, preview sheet | W12-23 |
| 17 | Locked steel + padlock variants, export pipeline, glyph-placeholder fallback | W12-24 |
| 18 | `BadgeMint` outbox via mock `BadgeNftPort` (`planned → sent → minted / failed / skipped`, 1 h delay) | W12-25 |
| 19 | Card back "Recorded on NEAR" (real) vs "Recorded (mock)" | W12-26 |
| 20 | In-game toasts: achievement earned, level up | W12-27 |
| 21 | PA-01 (all 60 tiers earnable, exact XP once) | W12-28 |
| 22 | PA-03 no `innerHTML`; PA-04 viewports | W12-29 |
| 23 | Analytics: profile view, card flip, share | W12-30 |
| 24 | Dev console: facts, XP, reset | W12-31 |
| 25 | PA-02, PA-05 in the wave e2e | W12-32 |

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W12-01 | Contracts + catalogue `achievements.ts` (pure, no imports; 20 × 3 frozen ids, thresholds, XP, ★, glyph, `producerWave`; Stockpile counts the sum of every produced sub-resource of the three D-34 families from W02-28's `resourceProduced`, Energy excluded), `ProgressEventV1 {playerId, family, delta \| max, sourceId}`, profile DTOs, flag `W12` | contract | M | H | W00-01 | Unit test: 60 tiers, unique ids, ids match `family`, `family-2`, `family-3`; sum of XP = 13 800 | Profile §3, §5 | TA-15.1 |
| W12-02 | Server: `Facts` table (one row per player) + updater on the progression bus (counter += delta, max = max(old, new)) | server | M | H | W12-01 | Publish `{family:'groundbreaker', delta:50}` twice → the facts value is 100; `{max:5}` then `{max:3}` → 5 | Profile §5 | TA-15.1 |
| W12-03 | Server: `AchievementUnlock` append-only + `progressOf()` + `evaluate()` on each fact change | server | M | H | W12-02 | Facts reach the Bronze threshold → exactly one unlock row with `earnedAt`; deleting rows is not possible through the service | Profile §3 | TA-15.1 |
| W12-04 | Server: catch-up evaluation on profile load (unlocks any earned-but-missing tiers) | server | S |  | W12-03 | Insert facts directly above a threshold, then `GET /me/profile` → the unlock is created during the request | Profile §3 | TA-15.1 |
| W12-05 | Server: `XpLedger (playerId, source, sourceId) unique`, `PlayerXp`, level curve `50·L·(L+1)`, cap 30 | server | M | H | W12-03 | Earn Groundbreaker Bronze twice through re-evaluation → one ledger row and +50 XP once; 5 500 XP → level 10 | Profile §2 | TA-15.1 |
| W12-06 | Server: milestone XP consumers (first-time stage `10 × n` from W08's `stageReached`, Settled 500 from W21's `colonySettled` (idle until W21 lands; the `settler` achievement increment is W21-18's), survived planet 200 from W11's `planet_result`) | server | S |  | W12-05, W08-03, W11-05 | Fire `stageReached S3` for an account the first time → +30 XP; fire it again → +0 | Profile §2 | TA-15.1 |
| W12-07 | Server: titles (levels 2, 5, 10, 15, 20, 25, 30), avatar frames (3, 8, 13, 18, 23, 28), nameplate colour at 10, gold border at 30 | server | S |  | W12-05 | Reach level 5 → `title = "Surveyor"` and frames 1–2 unlocked in the profile DTO | Profile §2 table | TA-15.1 |
| W12-08 | Server: family availability from wave flags (`producerWave` off → `status:'coming_soon'`, no progress shown) | server | S | H | W12-01 | `TA_WAVES=..12` → Warlord, Diplomat, Merchant, Settler are `coming_soon` in `/me/achievements` | PRODUCT_WAVES §3 | — |
| W12-09 | Server: `GET /me/profile` (identity, level, XP, title, frame, stats, current and past colonies, next 3 achievements, `unlockStage` = W08-07's account `maxStage` when on, else the live colony's `unlockStage` from W08-06) | server | M | H | W12-05, W08-06 | Call it for the scenario pilot → all fields present and `unlockStage = 4`; p95 ≤ 150 ms | Profile §5 | TA-15.2 |
| W12-10 | Server: history writer (consumes founded, stageReached, hubUpgraded, raidRepelled/lost, nestCleared, truce signed/broken, big trade, rocket launched, settled, eliminated, achievement earned) | server | M | H+ | W12-03 | Reach S2 and repel a raid → 2 history rows with planet, icon and one-line text | Profile §1 #5 | TA-15.2 |
| W12-11 | Server: `GET /me/history?cursor=&planet=&type=` (50 per page, filters) | server | S | H+ | W12-10 | 120 rows, page 1 → 50 rows and a cursor; filter by planet → only that planet | Profile §1 #5 | TA-15.2 |
| W12-12 | Server: `GET /me/achievements` (every tier: `tierName`, status, progress `{value, target}`, `earnedAt`, nft status) | server | S | H | W12-03, W12-08 | Response has 60 entries in catalogue order; earned entries have `earnedAt` | Profile §5 | TA-15.2 |
| W12-13 | Client: `/me` page shell (`frontend/me.html` + `frontend/game/pages/me/`, sticky section tabs, Faction Plate plates and eyebrows from `frontend/design/css/{tokens,base}.css`, 560 px stack, `el()`/`textContent` only) | client | M | H | W12-09 | Open `/me.html` at 1 280 px → tabs stick on scroll; at 360 px portrait → one column with no horizontal scroll | Profile §1 rules | TA-15.3 |
| W12-14 | Client: Pilot section (avatar + frame, name + rename link, Pilot ID, "pilot since", level badge, XP bar, title) | client | S | H | W12-13 | Scenario pilot → "Level 4", XP bar 1 120 / 1 500, title "Surveyor" | Profile §1 #1 | TA-15.3 |
| W12-15 | Client: Progress section (level/XP detail, 11-segment `unlockStage` track with next condition, next 3 achievements with bars) | client | S | H | W12-13 | Scenario pilot → the stage track lights S0–S4; 3 achievement bars with `value / target` | Profile §1 #2 | TA-15.3 |
| W12-16 | Client: Stats tiles (`repeat(auto-fit, minmax(130px, 1fr))`, the 16 stats in profile §1 #4) | client | S | H | W12-13 | 16 tiles render; numbers formatted with thin spaces | Profile §1 #4 | TA-15.3 |
| W12-17 | Client: Planets cards (current: planet, type, stage, terraform %, Living n/m, threat stage, online/away, Dive in; past: settled/eliminated/departed, Deed link if W20 on) | client | M | H+ | W12-13 | Click Dive in on the current card → the game opens that colony | Profile §1 #3 | TA-15.3 |
| W12-18 | Client: History timeline (date · planet · icon · text, filters by planet and type, infinite scroll) | client | M | H+ | W12-11, W12-13 | Choose a planet filter → only its rows remain; scroll to the end → the next page loads | Profile §1 #5 | TA-15.3 |
| W12-19 | Client: Play section (the W11 planet cards, queue and party from `frontend/game/pages/lobby/` as DOM, without the orbit backdrop; Join hands off to `/play.html`; when W11 is off → a single "Play" button to `/play.html`) | client | S |  | W12-13, W11-22 | With W11 on → the planet list renders inside `/me.html`; with W11 off → only the Play button | Profile §1 #7 | TA-15.3 |
| W12-20 | Client: achievement ladders (one block per family, eyebrow h3, horizontal scroll-snap ladder of 3 cards, header `earned / 60 · XP`) | client | M | H | W12-12, W12-13 | 20 family blocks render with 3 cards each; on a phone the ladder scrolls horizontally | Profile §4 | TA-15.4 |
| W12-21 | Client: flip card (hover on hover devices, tap toggles `.flip`, Enter/Space, `aria-expanded`, `perspective 900px`, `.75s cubic-bezier(.2,.8,.2,1)`, front hidden at .38 s, sheen .85 s, reduced-motion crossfade, entry stagger `--i × 70ms`) | client | M | H | W12-20 | Tab to a card, press Space → it flips and `aria-expanded="true"`; with `prefers-reduced-motion` → opacity crossfade and no sheen | Profile §4, PA-02 | TA-15.4 |
| W12-22 | Client: card states (locked steel art at .85 opacity, next-tier description, earned gradient border + glow, tier colours, chamfered progress bar, back face, Share-to-X button) | client | M | H | W12-21 | An earned card shows "✓ date" in `--ta-terra` and the orange→terra border; Share opens the X intent URL with the text and link | Profile §4 | TA-15.4 |
| W12-23 | Visual: badge art generator `frontend/design/achievements/generate.mjs` (1024² hex medallion SVG + PNG, tier rim gradients, 3 pips lit by tier, Gold outer ring + glow, 20 family glyphs) + `preview.html` | visual | M | H | W12-01 | `node generate.mjs` → 60 earned images + `preview.html` with all 60 at a glance | Profile §4 badge art | TA-15.5 |
| W12-24 | Visual: locked steel + padlock variants, export to 512 px WebP in `frontend/public/img/achievements/`, glyph-placeholder fallback if art is missing | visual | S |  | W12-23 | Delete one PNG → its card shows the glyph placeholder; locked variants exist for all 60 | Profile §4 | TA-15.5 |
| W12-25 | Server: `BadgeMint` outbox (`planned → sent → minted / failed / skipped`, 1 h delay, deterministic `opId`) through mock `BadgeNftPort` | server | M |  | W12-03, W00-35 | Earn a tier, warp 1 h → the outbox row is `minted` with a `mock:` tx; re-running the relay → no second mint | Profile §3, NEAR §1a | TA-15.8 |
| W12-26 | Client: card back mint status ("Badge minting…", "Recorded (mock)", real → "Recorded on NEAR" + explorer link) | client | S |  | W12-25, W12-22 | A mock-minted tier's back shows "Recorded (mock)" and no explorer link | Profile §3, PA-05 | TA-15.8 |
| W12-27 | Client: in-game toasts for achievement earned and level up (server events only, D-31; Faction Plate; links to `/me.html#achievements`) | client | S | H | W12-03, W12-05 | Earn a tier in game → a toast with the badge art; click → `/me.html` scrolls to that card | Profile §1 | — |
| W12-28 | Test PA-01: scripted scenario earns all 60 tiers via producer events (or dev grants for families whose wave is off); each adds exactly its XP once | test | M |  | W12-05 | `npm run test:int progression-all-tiers` → 60 unlocks, total XP 13 800 + milestones, no duplicates after re-evaluation | PA-01 | TA-15.1 |
| W12-29 | Test PA-03 no `innerHTML` in `frontend/game/pages/me` and `frontend/game/features/achievements`; PA-04 screenshots at 360 × 640 portrait and 844 × 390 landscape | test | S |  | W12-22 | `npm test no-innerhtml` passes; screenshot test shows no horizontal scroll at both sizes | PA-03, PA-04 | TA-15.3 |
| W12-30 | Analytics: `profile_viewed{section}`, `achievement_flipped{id}`, `achievement_shared{id}`, `level_up{level}` | client | S |  | W12-21 | Flip a card with consent on → one `achievement_flipped` row | CLIENT §10.3 | — |
| W12-31 | Dev console: `fact add <family> <n>`, `xp add <n>`, `profile reset` (dev only) | client | S | H | W12-02 | `xp add 5500` → level 10 on `/me.html` after refresh | PRODUCT_WAVES §3 | — |
| W12-32 | Wave e2e + seed scenario `w12-profile` + tag `wave-12` (asserts PA-02 keyboard flip and PA-05 mock mint) | test | M | H | all W12 | `npm run e2e -- --waves ..12` → the demo story passes, and every earlier suite passes | PRODUCT_WAVES §3 | — |

## Wave DoD

- `e2e/w12.spec.ts` passes, together with all earlier suites.
- `?scenario=w12` loads the profile pilot.
- `TA_WAVES=..11` removes the `/me` link and the profile API (`wave_disabled`).
- Tag `wave-12` is created.
- PA-01..PA-05 are covered.
- Each producer wave owns its "emit progression events for <family>" issue; this wave only consumes the events.
