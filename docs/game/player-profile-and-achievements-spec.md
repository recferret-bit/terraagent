# TerraAgent — Player Page, Achievements & Progression

> **Status:** v0.1 (2026-10-30), proposed as D-29 ([`DECISIONS.md`](../spec/DECISIONS.md)).
> **References:** freightchain's achievement system and profile, adapted:
> - catalogue: `backend/server/src/domain/achievements/achievements.ts`
> - flip cards: `frontend/client/css/flip-card.css`, `site/lobby-achievements.js`
> - profile: `site/lobby-profile.js`
>
> **Visual system:** TerraAgent "Faction Plate" ([`frontend/design/css/tokens.css`](../../frontend/design/css/tokens.css)): `--ta-*` tokens, chamfered plates (no `border-radius`), orange for action and selection, blue for systems, Chakra Petch / IBM Plex.
> **Data sources:** sim events ([`SIMULATION.md`](../spec/SIMULATION.md) §9), lobby/matchmaking ([`MATCHMAKING.md`](../spec/MATCHMAKING.md)), NEAR ports ([`NEAR.md`](../spec/NEAR.md), all mocked in phase 1).

## 1. Player page (`/me`) — sections

The page is one scrolling page with sticky section tabs: **PILOT · PROGRESS · PLANETS · HISTORY · ACHIEVEMENTS · PLAY**. Each section is a `.ta-plate` with an eyebrow label (13 px, tracking `.16em`, `--ta-steel`).

| # | Section | Content |
|---|---|---|
| 1 | **Pilot** (identity) | Avatar frame (unlocked by level), display name (generated or renamed, D-22), named NEAR account shown as "Pilot ID" (the chain stays invisible: no wallet words), "pilot since", **level badge + XP bar**, current title |
| 2 | **Progress** | Level and XP to next level. `unlockStage` (highest stage ever reached, S0–S10) as a 11-segment stage track with the next stage's unlock condition. Next 3 achievements closest to their next tier (progress bars). Season stats line |
| 3 | **Planets** | Cards for **current** colonies (planet, type, stage, terraform %, Living n/m launch gate, threat stage, online/away, "Dive in" button) and **past** colonies (Settled, eliminated, departed). Each card links to the planet's history and the colony's Deed (F6, mocked) |
| 4 | **Stats** (inside Progress) | Tile grid, `repeat(auto-fit, minmax(130px, 1fr))` as in freightchain: colonies founded, planets settled, playtime, buildings built, tiles prepared, Living tiles, walls raised, resources produced, fauna killed, raids repelled, PvP units destroyed, trades settled, market fees earned, Guild trades, truces signed, rockets launched |
| 5 | **History** | Timeline (last 50, paged): colony founded, stage reached, Hub upgraded, raid repelled or lost, nest cleared, truce signed or broken, big trade, rocket launched, colony settled or eliminated, achievement tier earned. Each row: date · planet · icon · one-line text. Rows are filterable by planet and type |
| 6 | **Achievements** | 20 families × 3 tiers in ladders (§3). Header `ACHIEVEMENTS · earned / 60 · XP from achievements` |
| 7 | **Play** (matchmaking) | Planet picker (type, seats, age, admission window; MATCHMAKING), **party** create / join by code (D-22), queue state, the "Join same type" fallback, and a "resume colony" shortcut if one is active |

Rules:
- Server text enters the DOM only via `textContent` / `el()`, never `innerHTML` (freightchain rule).
- Respect `prefers-reduced-motion`.
- Full play works on phones in landscape (D-22). Below 560 px the profile stacks into one column.

## 2. Player level & XP

XP is earned once per account, never lost, and is **cosmetic and social only**: titles, avatar frames, badge flair. It gives no gameplay power, because every colony must start fair.

| Source | XP |
|---|---|
| Achievement tier earned | Bronze **50** · Silver **150** · Gold **400** (harder families: 100 / 300 / 800, marked ★ in §3) |
| First time an account reaches stage S*n* | 10 × *n* (S1 = 10 … S10 = 100, 550 in total) |
| Colony Settled (rocket launch gate met) | 500 per colony |
| Planet survived to planet end (colony still active) | 200 |

**Level curve.** Total XP needed for level *L* is `50 × L × (L + 1)`. Level 1 needs 100, level 5 needs 1 500, level 10 needs 5 500, and level 20 needs 21 000. The cap is **level 30** (46 500 XP).

| Level | Reward |
|---|---|
| 2, 5, 10, 15, 20, 25, 30 | Titles: Cadet → Surveyor → Engineer → Terraformer → Warden → Admiral → Architect of Worlds |
| 3, 8, 13, 18, 23, 28 | Avatar frames, plain to animated |
| 10 | Colony name plate colour |
| 30 | Gold Faction Plate border on the profile |

## 3. Achievements — 20 families × 3 tiers

Rules carried over from freightchain:
- **Ids are frozen.** Tier 1 keeps the family id, and higher tiers add a suffix (`groundbreaker-2`).
- **Unlocks are append-only.**
- **Progress** is `progressOf(facts) → {value: min(floor(raw), target), target, done}`.
- **Facts** is a per-account aggregate, updated from sim events and lobby events.
- **Evaluation** runs on the relevant event and again as a catch-up when the profile loads.

Difference from freightchain: **exactly 3 tiers** (Bronze / Silver / Gold), plus XP.

| # | Id | Name | Description (what counts) | Bronze / Silver / Gold | XP |
|---|---|---|---|---|---|
| 1 | `first-landfall` | **Landfall** | Found colonies (the Hub completes) | 1 / 3 / 10 | 50 / 150 / 400 |
| 2 | `groundbreaker` | **Groundbreaker** | Tiles Graded to Prepared | 100 / 1 000 / 10 000 | 50 / 150 / 400 |
| 3 | `stone-mason` | **Stone Mason** | Obstacles removed (Clear, Break, Level, Fill) | 50 / 500 / 5 000 | 50 / 150 / 400 |
| 4 | `hydro-engineer` | **Hydro Engineer** | Water tiles reclaimed (Shallow or Deep) | 10 / 100 / 1 000 | 50 / 150 / 400 |
| 5 | `green-thumb` | **Green Thumb** | Tiles turned Living | 50 / 500 / 5 000 | 50 / 150 / 400 |
| 6 | `architect` | **Architect** | Buildings completed | 25 / 250 / 2 500 | 50 / 150 / 400 |
| 7 | `power-broker` | **Power Broker** | Peak net power of one colony (E/s) | 100 / 500 / 2 000 | 50 / 150 / 400 |
| 8 | `night-shift` | **Night Shift** | Nights survived with no brownout beyond terraform shedding | 1 / 10 / 50 | 50 / 150 / 400 |
| 9 | `stockpile` | **Stockpile** | Resources produced, all types | 10 k / 100 k / 1 M | 50 / 150 / 400 |
| 10 | `tech-ascendant` ★ | **Ascendant** | Highest stage reached | S5 / S8 / S10 | 100 / 300 / 800 |
| 11 | `exterminator` | **Exterminator** | Fauna killed | 50 / 500 / 5 000 | 50 / 150 / 400 |
| 12 | `nest-breaker` | **Nest Breaker** | Fauna nests destroyed | 1 / 10 / 50 | 50 / 150 / 400 |
| 13 | `great-wall` | **Great Wall** | Ridge or Moat tiles raised | 20 / 200 / 2 000 | 50 / 150 / 400 |
| 14 | `unbreached` | **Unbreached** | Raids repelled without losing a building | 5 / 50 / 250 | 50 / 150 / 400 |
| 15 | `warlord` ★ | **Warlord** | Enemy units destroyed in PvP | 10 / 100 / 1 000 | 100 / 300 / 800 |
| 16 | `merchant` | **Merchant** | Market trades settled | 5 / 50 / 500 | 50 / 150 / 400 |
| 17 | `port-authority` | **Port Authority** | Fees earned by your Trade Hub stalls (units) | 100 / 1 000 / 10 000 | 50 / 150 / 400 |
| 18 | `guild-contact` | **Guild Contact** | Trades with the Orbital Guild | 5 / 50 / 250 | 50 / 150 / 400 |
| 19 | `diplomat` | **Diplomat** | Truces signed and kept to term (never broken by you) | 1 / 5 / 25 | 50 / 150 / 400 |
| 20 | `settler` ★ | **Star Settler** | Colonies Settled (rocket launched through the full-terraform gate) | 1 / 3 / 10 | 100 / 300 / 800 |

All 60 tiers give 13 800 XP. Together with milestone XP that reaches about level 16–17, so higher levels need long-term play.

**Optional chain layer (mocked in phase 1).** An earned tier can be minted as a soulbound **badge NFT** through `BadgeNftPort` (the NEP-171 family of F6). It uses freightchain's outbox: `planned → sent → minted | failed | skipped`, with a 1 h delay. The back of the card shows "Recorded on NEAR" with an explorer link only when the adapter is real.

## 4. Achievement card visuals

Mechanics come from freightchain. Look follows Faction Plate.

| Element | Spec |
|---|---|
| **Layout** | One block per family: an eyebrow `h3` (13 px, tracking `.16em`, `--ta-steel`), then a horizontal **ladder** of the 3 tier cards. `display:flex; gap:14px; overflow-x:auto; scroll-snap-type:x proximity`; card `flex: 0 0 clamp(220px, calc((100% − 28px)/3), 300px)` |
| **Card shape** | Chamfered plate (`clip-path` corner cut 12 px top-left and bottom-right), `--ta-plate` background, 1 px `--ta-seam` border. No `border-radius` |
| **Front** | Badge art (square, max 176 px), name (Chakra Petch 600, 16 px), tier label `BRONZE` / `SILVER` / `GOLD` (11 px, tracking `.14em`, tier colour). Earned: `✓ date` in `--ta-terra`. Locked: progress bar, and only the next tier to earn shows its description |
| **Back** | Name, description, threshold, XP reward, earned date or progress bar, and "Recorded on NEAR" if a real badge was minted. Earned cards also get a "Share" button that posts to X (orange action button, void text) |
| **Flip** | Hover on hover-capable devices; click or tap toggles `.flip`; Enter or Space toggles; `aria-expanded` is kept in sync. `perspective: 900px; transform-style: preserve-3d; transform: rotateY(180deg)` over `.75s cubic-bezier(.2,.8,.2,1)`, `backface-visibility: hidden`. The front gets `visibility:hidden` at 0.38 s, the mid-flip point |
| **Sheen on flip** | A 105° gradient sweep `--ta-orange 40% → --ta-energy 33% → --ta-terra 40%` over .85 s. This is the TerraAgent version of freightchain's "solsweep" |
| **Reduced motion** | The flip becomes an opacity crossfade, with no sheen |
| **Entry** | `translateY(10px) scale(.96) → none`, .55 s, staggered `--i × 70ms` |
| **Tier colour `--tier`** | Bronze `#C8844A`, Silver `#C9CED6`, Gold `#FFCF5A` (freightchain values) |
| **Locked** | Border `--ta-seam`, art at opacity .85, and a separate **steel + padlock** art variant (`<id>-locked.svg`) |
| **Earned** | 1 px gradient border `linear-gradient(135deg, var(--ta-orange), var(--ta-terra))` and glow `0 0 14px rgba(255,106,19,.15)`. Back face tinted `linear-gradient(160deg, rgba(255,106,19,.15), rgba(61,220,132,.12))` |
| **Progress bar** | 26 px tall, chamfered, background `#0008`, fill `linear-gradient(90deg, var(--ta-orange), var(--ta-energy))`, label in IBM Plex Mono 600, 13 px, `value / target` |
| **Badge art** | Generated by `frontend/design/achievements/generate.mjs` (port of freightchain's generator) as 1024² SVG and PNG. Shape is a **hex medallion**, matching the planet hex grid. Rim gradient per tier. 3 pips under the name banner, `tier` of them lit. Gold gets an outer ring and a glow. Each family has its own glyph: shovel, rock, droplet, sprout, crane, bolt, moon, crate, chevrons, bug, nest, wall, shield, crossed blades, coins, market stall, ship, handshake, rocket, flag. A contact sheet goes to `preview.html` |

## 5. Data & API (sketch)

- `Facts` (one row per player) holds counters for the 20 families plus `maxStage` and `peakPowerEs`. It is updated by the `progression` module from sim events in the same app (D-24).
- `AchievementUnlock (playerId, achievementId) PK, earnedAt, planetId?` is append-only.
- `BadgeMint` outbox: `planned | sent | minted | failed | skipped`, through `BadgeNftPort` (mock adapter in phase 1).
- `PlayerXp (playerId, xp, level, title, frame)`, plus an `XpLedger (playerId, source, sourceId) unique` table, so XP is idempotent.
- `GET /me/profile` returns the identity, level, stats, current and past colonies, and the next 3 achievements. `GET /me/history?cursor=` returns history pages. `GET /me/achievements` returns every tier with progress. `POST /me/party` and `POST /me/party/join` handle parties. Matchmaking reuses the lobby endpoints.

## 6. Acceptance

| ID | Check |
|---|---|
| `PA-01` | Every one of the 60 tiers can be earned in a scripted sim scenario, and earning it adds exactly the listed XP once, even across re-evaluation |
| `PA-02` | Card flip works with mouse hover, tap, and keyboard (Enter or Space). With reduced motion it crossfades instead |
| `PA-03` | No `innerHTML` in profile or achievement code (test) |
| `PA-04` | The profile renders at 360 × 640 portrait (stacked) and in phone landscape without horizontal scroll |
| `PA-05` | With the mock NEAR adapters, a badge goes `planned → minted` and the card back shows a mock record. With a real adapter it shows the explorer link |
