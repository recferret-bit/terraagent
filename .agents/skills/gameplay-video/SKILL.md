---
name: gameplay-video
description: Capture real TerraAgent 3D gameplay from declarative JSON specs and render Faction-Plate-styled MP4s, size-capped GIFs, contact sheets, and muxed soundtracks (`social/media/`). Use when asked to create a trailer, teaser, promo clip, social video, or gameplay GIF from a prompt or scenario.
---

# Declarative Gameplay Video & GIF Harness (`social/media/`)

Turns a prompt or scenario into a **100% declarative JSON spec** (`social/media/specs/*.json`), drives the real **TerraAgent** 3D engine (`@terra/sim` + `@terra/render` + `OnlineSession` + `DescentRunner`) deterministically on a virtual clock in headless Chrome (Metal WebGL), layers **Faction Plate** chamfered HUD typography & NEAR contract callout pills, muxes any external soundtrack file (`.mp3` / `.wav` / `.m4a`) with configurable offset and fades, and encodes `.mp4`, `.min.mp4`, `.gif`, `.min.gif`, `.tiny.gif`, and a multi-tile QA `contact.jpg`.

---

## 1. Non-Negotiable Guardrails

1. **100% Declarative Specs:** Every scene, planet (`dune` | `oceanForest` | `forestRock`), mode (`descent` | `colony` | `orbit`), world setup (`flatten`, `colony`, `build`, `deposit`, `obstacle`, `unit`, `hive`, `prop`, `guildShip`), timed gameplay event (`lightning`, `meteor`, `rain`, `terraformWave`, `spawnRaid`, `attackMove`, `guildShip`, `time`), camera move, transition, bumper, caption, Web3 pill, soundtrack (`audio`), and end card MUST live in the JSON spec (`social/media/specs/<name>.json`). Never hardcode clip-specific logic in `stage-runtime.mjs` or `page.js`.
2. **Faction Plate Design System (`AGENTS.md` §4):**
   - **Zero `border-radius`** on overlays — all plates, pills, bumpers, and cards use 45° chamfered corners (`clip-path: polygon(...)`).
   - Palette: `--ta-void` (`#07080A`), `--ta-plate` (`#111318`), `--ta-hull` (`#F2F4F7`), `--ta-orange` (`#FF6A13` — **always `#07080A` void text on orange, never white**), `--ta-blue-hi` (`#5B8CFF`), `--ta-energy` (`#39D0FF`), `--ta-terra` (`#3DDC84`).
   - Fonts: `Chakra Petch` (uppercase display headlines), `IBM Plex Sans` (subtitles), `IBM Plex Mono` (step tags, telemetry ticker, `.terraagent.testnet` contract pills).
   - Keep overlays compact and safe-framed (`#fx-safe` adapts to `16:9`, `crop: "square"`, and `9:16` `look: "meme"` / `crop: "vertical"` with `z-index: 20000` above weather overlays) so `--preview` matches production layout 1:1 and the center `75%+` of the 3D diorama stays unobstructed.
3. **Pure Virtual Time (`clock.js`) & Clean Viewport:** `clock.js` virtualizes `performance.now`, `Date.now`, `requestAnimationFrame` / `cancelAnimationFrame`, and `Math.random` (xorshift32). Never use CSS `transition` or `@keyframes` in overlays; compute all transforms/opacities as pure functions of `videoT` inside `window.__frame(videoT, dtSec)`. Never enable `initCrt` debug toolbars during capture.
4. **Honest NEAR Copy (`HACKATHON.md`, `README.md`, `D-44`):** Cite real deployed Testnet contracts (`res`, `deed`, `bounty`, `staking`, `dao`, `pilots.terraagent.testnet`), `11/11` live Testnet ports, `NEP-366` gasless `relayer.terraagent.testnet` + `claimAccount` self-custody, `NEP-245` cargo, 4-way `NEP-413` + live `1Click` quotes (`1.00% -> 0.50%` fee for `>= 10 NEAR` stakers, `80%` Protocol / `20%` Planet DAO), `80/20` lossless staking (`0%` P2W, `403 AI_STAKING_FORBIDDEN`), native `NEAR` Peace/War bonds (`90%` Victim / `10%` Protocol slash), `20x5` `*.swarm.terraagent.testnet` clearing, `NEAR.AI` Cloud TEE (`z-ai/glm-5.3-flash` + `AES-256-GCM` BYOK), and `protocol.terraagent.testnet` self-funding loop. Never claim unshipped Mainnet TVL.

---

## 2. Commands

```bash
# One-time setup (installs ffmpeg-static & eslint in social/media)
npm run install:media

# Fast half-res 12 fps preview -> inspect out/video/<name>-preview/contact.jpg FIRST (never overwrites production out/video/<name>/)
npm run media -- social/media/specs/trailer.json --preview

# Render a specific time slice (seconds a-b -> out/video/<name>-partial/) while tuning one scene
npm run media -- social/media/specs/trailer.json --only 17.5-24.5 --keep

# Full production render (.mp4, .min.mp4, .gif, .min.gif, .tiny.gif, contact.jpg, timeline.json)
npm run media -- social/media/specs/trailer.json

# Remux soundtrack onto an existing rendered video without recapturing 3D frames (~1 s)
npm run media -- social/media/specs/trailer.json --remux

# Mux an arbitrary song onto any .mp4
node social/media/make.mjs --add-audio clip.mp4 "social/Planet Select (1-Min Cut).mp3"

# Lint + unit/ffmpeg test suite
npm run media:check
```

---

## 3. Declarative Spec Vocabulary (`social/media/video/spec.mjs`)

### Top-Level Fields
- `name`: output folder/file slug (`social/media/out/video/<name>/`)
- `fps`: `12..60` (default `24`), `width` / `height` (default `1280` x `720`; `look: "meme"` defaults to `1080` x `1920`)
- `maxSeconds`: duration cap (`default 15`; set `55` for a 55 s trailer)
- `look`: `"faction"` (default) | `"big"` | `"meme"`, optional `crop`: `"square"` | `"vertical"`
- `ticker`: top telemetry ribbon string (or `false`), `badge`: top-right status chip (or `false`)
- `gif`: `{ maxMB, width, fps }`
- `audio`: `false` (silent), `"../../Planet Select (1-Min Cut).mp3"`, or `{ src, offset: 0, fadeIn: 0.4, fadeOut: 2.2, gainDb: 0, loop: true }`

### Scene Fields (`scenes[]`)
- `id`, `dur` (`0.5..30` s), `mode`: `"colony"` | `"descent"` | `"orbit"`
- `planet`: `"dune"` (desert) | `"oceanForest"` (archipelago ocean) | `"forestRock"` (temperate pine/granite)
- `scenario`: optional `@terra/scenarios` id (`"w05"`, `"w07"`, `"w10"`, `"w15"`, `"w18"`, `"w20"`, `"w22"`, etc.)
- `descent`: `{ from: 18.5, to: 34.85 }` (maps authored `DescentRunner` timeline seconds `[from, to]` onto `dur` — `18..23` plasma reentry, `23..29` cloud break, `32..34` retro burn, `34..34.85` touchdown & Hero deploy)
- `camera`: `{ q, r, y: number|[y0,y1], pan: [[q0,r0],[q1,r1]], dist: number|[d0,d1], yaw: number|[y0,y1], elev, shake }`
- `fov`: optional `boolean` (`default true`; set `false` for multi-colony spectator shots so rival bases and units stay visible without fog-of-war dimming)
- `time`: solar hour `0..24` OR speed-warped range `[fromHour, toHour]` (e.g. `[10.5, 32.8]` warps day -> crimson dusk -> floodlit night -> golden dawn)
- `weather`: `{ rain: "none"|"minor"|"heavy"|0..1, storm: boolean, wetness: 0..1, puddles: 0..1, lightningFlash?: 0..1 }`
- `setup[]`: pre-scene world builders:
  - `{ op: "flatten", q, r, radius, living?, owner?, clearDeposits?, clearFauna?, clearBuildings?, clearOwners? }`
  - `{ op: "colony", index, name, stage?, color?, stock? }` (foreign colonies `index > 0` automatically tint their kitbash `hullSecondary` / beacon accents to `color`)
  - `{ op: "build", building, q, r, instant?: true|false, progress?: 0..1, tier? }` (`instant: false` spawns live 3D scaffolding + `BuildingJobRecord` for builders to weld; also supports landmark buildings `hydro`, `hazardShield`, `lightningRod`)
  - `{ op: "deposit", kind: "metals"|"minerals"|"oil", q, r, radius? }`
  - `{ op: "obstacle", kind: "tree"|"rock"|"dune"|"hole"|"water", q, r, radius? }`
  - `{ op: "unit", unit: "builder"|"harvester"|"recon"|"tank"|"artillery"|"blackAnt"|"blueBeetle"|"greenSpitter", q, r, count, colonyIndex?, owner? }`
  - `{ op: "hive", species: "blackAnt"|"blueBeetle"|"greenSpitter", q, r, residents, mode }`
  - `{ op: "guildShip", q, r, hubQ?, hubR?, scale?, fromAlt?, descentDur?, bob?, owner?, color? }` (live `GuildShipRig` freighter with 4 Mach-diamond belly retro-thrusters & spinning dishes)
  - `{ op: "prop", model: "building.rocket"|"ship.guildTrader"|"ship.carrier", q, r, y?, yaw?, scale?, bob? }`
- `events[]`: timed in-scene triggers (`{ t, do, ... }`):
  - `lightning` (`{ q, r, hexCount }`), `meteor` (`{ q, r, hexCount }` — impacts `~2.0s` after launch!), `rain`, `twister`
  - `terraform` (`{ op, q, r, radius }`), `terraformWave` (`{ q, r, radius, dur }` — ripples `prepared -> irrigated -> living` hex rings)
  - `spawnRaid`, `spawnUnit`, `attackMove`, `build`, `time`, `camera`, `cmd`
- Overlays: `transition` (`cut` | `flash` | `flash-orange` | `whip` | `glitch` | `zoom` | `dip` | `punch` | `spin`), `bumper`, `captions[]`, `pills[]`, `shots[]`, `card`.

---

## 4. Mandatory Visual QA Loop

1. Run `--preview` first (`640x360 @ 12 fps` -> `social/media/out/video/<name>-preview/`).
2. Read `social/media/out/video/<name>-preview/contact.jpg` (and individual scene PNGs when `--keep` is set) to verify:
   - Every scene visibly shows the action promised by its caption (pod touching down, builders welding, living hex wave expanding, lightning bolt + meteor crater on forest planet, night floodlights glowing, insects clashing with turrets, clear non-overlapping chamfered text).
   - `0` browser runtime errors reported by `make.mjs`.
3. Only after `contact.jpg` passes visual QA, run the full render (`npm run media -- social/media/specs/<name>.json`).
