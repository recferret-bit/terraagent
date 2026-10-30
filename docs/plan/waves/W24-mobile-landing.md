# W24 — Mobile, PWA & Landing

> **Track:** Client (C) · **Flag:** `W24` · **Tag:** `wave-24` · **Scenario:** `scenarios/w24-mobile.ts` · **Depends on:** W04 (camera, selection, maps). It can share the service worker with W09 (push) but does not depend on it.
> **Specs:** [`CLIENT.md`](../../spec/CLIENT.md) §9 (phone ≥ 30 FPS, landing bundle budgets, quality tiers), §11 (phones, touch, PWA, WCAG), §12 (edge cases) · D-22 (full phone gameplay in landscape fullscreen; live landing diorama; WebGL2) · D-23 (Cloudflare) · [`CONTINUITY.md`](../../spec/CONTINUITY.md) CT-37 (notification deep links) · [`AGENTS.md`](../../../AGENTS.md) Pillar 4 · [`CLAUDE.md`](../../../CLAUDE.md) (pages, Faction Plate)
> **Owned paths:** `client/src/mobile/**`, `client/src/core/input/touch/**`, `client/src/render/quality/**`, `public/manifest.webmanifest`, `public/icons/**`, `client/src/sw/**` (shared with W09; W24 creates the worker shell and W09 adds the push handler), and for the landing `landing.html`, `src/landing/**`, `frontend/design/js/landing.js`. The live hero already exists (`src/landing/heroStage.ts`); this wave makes it lazy, budgeted and connected.

## Goal

1. **Phone play.** The full game is playable on a phone held in landscape:
   - fullscreen, or an installed PWA on iOS;
   - touch camera and touch orders;
   - a responsive HUD with the order menus in a bottom drawer;
   - ≥ 30 FPS on the `low` tier.
2. **Landing.** The landing page loads fast:
   - the live Three.js mini-diorama hero is a lazy chunk of ≤ 200 KB with a poster fallback;
   - live planet stats;
   - a CTA that leads straight into the game.

## Demo story (`e2e/w24.spec.ts`, emulated iPhone 13 and Pixel 7 profiles)

1. Open `/play.html?scenario=w24` in **portrait** → **see** the "Rotate your phone" prompt with the colony status card (resources, alerts, stage).
2. Rotate to **landscape** → **see** the "Tap to play fullscreen" plate. Tap it → **see** fullscreen; the orientation stays locked to landscape on Android.
3. On the iOS profile (no element fullscreen) → **see** the "Add to Home Screen" sheet. Open with `display-mode: standalone` → **see** the game fill the screen inside the safe areas.
4. One-finger drag → **see** the camera pan. Pinch → **see** it zoom. Two-finger twist → **see** a 90° yaw snap.
5. Tap a harvester → **see** it selected. Long-press a tile → **see** the context menu (Build here / Terraform / Move).
6. Open the bottom drawer → **see** the Construction, Terraform, Units and HQ Goals menus as tabs. Place a building with a tap-to-place ghost and a confirm button → **see** the order appear in the queue.
7. The perf probe runs 20 s with 150 buildings and 250 robots → **see** ≥ 30 FPS median on the `low` tier.
8. Open `/landing.html` on 4G throttling → **see** the poster within 1.5 s and the live diorama swap in after first paint; the initial JS is ≤ 50 KB gzip.
9. Tap "Play now" → **see** `/play.html` open on the guest boot flow.
10. Toggle `?waves=..23` → **see** desktop-only behaviour: no rotate prompt, no drawer, no PWA install prompt; the landing hero is unchanged.

## Features covered

| # | Feature (spec) | Issues |
|---|---|---|
| 1 | Device and orientation detection, a `phone` layout class, landscape-only gameplay (D-22, §11) | W24-02 |
| 2 | Portrait "Rotate your phone" prompt with the latest `/me/home` status card (§11) | W24-03 |
| 3 | Landscape fullscreen request (Fullscreen API) with orientation lock where supported; re-request after exit (§11) | W24-04 |
| 4 | iOS path: no element fullscreen, so offer "Add to Home Screen" and run as a standalone PWA (§11, D-22) | W24-05, W24-06 |
| 5 | Web app manifest, icons, theme colours, `display: standalone`, `orientation: landscape` (follow-up from §11) | W24-05 |
| 6 | Service worker shell: offline shell page and version check (no gameplay caching; protocol-mismatch rule §12); W09 adds push on top | W24-07 |
| 7 | Safe-area insets (`env(safe-area-inset-*)`) for HUD, drawer and minimap (follow-up from §11) | W24-08 |
| 8 | Touch camera: one-finger pan, pinch zoom, two-finger rotate (90° snap, as on desktop), inertia, no browser gestures inside the canvas (§11) | W24-09, W24-10 |
| 9 | Touch selection and orders: tap select, tap-hold drag for box select, long-press context menu, double-tap to centre (§11) | W24-11, W24-12 |
| 10 | Order menus as a bottom drawer with tabs; tap-to-place ghost with confirm/cancel; prep bill readable at phone size (§11) | W24-13, W24-14 |
| 11 | Responsive HUD: resource bar, power, queue panel, event log and selection panel in phone-landscape layouts; minimap 140 px (CLIENT §8b, §11) | W24-15, W24-16 |
| 12 | Touch targets ≥ 44 px, WCAG 2.2 AA on phone HUD, reduced motion (§11) | W24-17 |
| 13 | Quality tiers `high` / `medium` / `low`: auto-pick from the median frame time over the first 5 s, player override in settings, `localStorage` with try/catch (§9) | W24-18 |
| 14 | Phone render budget: DPR cap 1.25, `low` tier default on phones, entity LOD, terrain LOD, post-processing off on `low`, shadow tiers (§9) | W24-19, W24-20 |
| 15 | Phone thermal and battery behaviour: frame cap 30 when on battery saver or hidden, pause when the tab is hidden, resume without reconnect (follow-up from §11) | W24-21 |
| 16 | WebGL context lost/restored on mobile: overlay, rebuild from the WorldStore (§12) | W24-22 |
| 17 | Notification deep links open the right colony and panel on the phone (CT-37) | W24-23 |
| 18 | Phone perf probe: ≥ 30 FPS with 150 buildings + 250 robots on iPhone 13 / Pixel 7 profiles (§9) | W24-24 |
| 19 | Landing: live hero (existing `heroStage.ts`) as a lazy chunk ≤ 200 KB gzip after first paint; static poster as LCP; initial landing JS ≤ 50 KB (§9, D-22) | W24-25, W24-26 |
| 20 | Landing: no WebGL2 or reduced motion → poster only; visibility-based pause of the hero (§11) | W24-27 |
| 21 | Landing: live planet stats (active planets, colonies, Living tiles) from a public endpoint, cached 60 s | W24-28 |
| 22 | Landing CTA → game: "Play now" opens the guest boot flow; "Resume colony" if already signed in | W24-29 |
| 23 | Landing SEO/meta, Open Graph image, legal placeholders, analytics opt-in banner | W24-30 |
| 24 | Landing responsive QA: 360 px phone to 4K, no horizontal scroll, touch-friendly sections | W24-31 |
| 25 | Device QA matrix: Chrome/Edge/Firefox/Safari desktop; iOS Safari + PWA; Android Chrome; tablet best effort (§11) | W24-32 |
| 26 | Analytics: `rotate_prompt_shown`, `fullscreen_entered`, `pwa_installed`, `quality_tier_set`, `landing_hero_loaded`, `landing_cta_clicked` | W24-33 |
| 27 | Dev console: `device.emulate phone\|tablet\|desktop`, `quality.set low\|medium\|high`, `perf.probe 20` | W24-02 |

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W24-01 | Contracts & data: register flag `W24`; client `DeviceProfile` and `QualityTier` types; public `GET /v1/public/stats` schema; manifest fields | contract | S |  | W04-01 | Boot with `TA_WAVES=..23` → see `W24` off and no device layer installed | PRODUCT_WAVES §3–4 | — |
| W24-02 | Device and orientation service (`phone` / `tablet` / `desktop`, portrait/landscape, standalone), plus dev console `device.emulate` | client | S |  | W24-01 | Run `device.emulate phone` in desktop Chrome → see the `phone` layout class applied | CLIENT §11 | TA-11.9 |
| W24-03 | Portrait rotate prompt with a colony status card from `/me/home` (resources, alerts, stage), Faction Plate | client | M |  | W24-02 | Open the game in portrait → see "Rotate your phone" and the colony card; rotate → see it disappear | CLIENT §11 | TA-11.9 |
| W24-04 | Fullscreen flow: "Tap to play fullscreen" plate, Fullscreen API request on a user gesture, `screen.orientation.lock('landscape')` where supported, re-prompt after exit | client | S |  | W24-02 | On the Pixel 7 profile tap the plate → see `document.fullscreenElement` set and the orientation locked | CLIENT §11, D-22 | TA-11.9 |
| W24-05 | PWA manifest + icons (192/512/maskable), `display: standalone`, `orientation: landscape`, theme colours from `--ta-*` | ops | S |  | W24-01 | Run Lighthouse PWA → see the manifest installable with no errors | CLIENT §11 | TA-11.9 |
| W24-06 | iOS "Add to Home Screen" sheet: detect iOS Safari without element fullscreen, show the instructions plate, skip it in standalone mode | client | S |  | W24-05 | On the iPhone profile (non-standalone) → see the sheet; with `display-mode: standalone` → see no sheet | CLIENT §11, D-22 | TA-11.9 |
| W24-07 | Service worker shell (`client/src/sw/`): offline shell page, version check, `skipWaiting` on protocol bump; extension point for W09's push handler | client | M |  | W24-05 | Go offline after the first load → see the offline shell instead of the browser error page | CLIENT §12 | TA-11.10 |
| W24-08 | Safe-area layout: CSS variables from `env(safe-area-inset-*)` applied to the HUD root, drawer and minimap | client | S |  | W24-02 | On an iPhone notch profile in landscape → see no HUD element under the notch | CLIENT §11 | — |
| W24-09 | Touch camera: one-finger pan with inertia, pinch zoom around the midpoint, `touch-action: none` on the canvas | client | M |  | W04-26, W24-02 | Drag with one finger → see a smooth pan; pinch → see the zoom clamp at the W04 limits | CLIENT §11 | TA-11.9 |
| W24-10 | Two-finger rotate gesture snapping to a 90° yaw (same as `Q`/`E`), with a ≥ 25° twist threshold so it does not fire during pinch | client | S |  | W24-09 | Twist two fingers by 40° → see one 90° yaw step | CLIENT §11, Pillar 4 | TA-11.9 |
| W24-11 | Touch selection: tap select, tap-hold-drag box select, double-tap a unit to centre, tap empty ground to deselect | client | S |  | W04-23, W24-09 | Tap-hold and drag over 3 harvesters → see 3 selected | CLIENT §11 | TA-11.9 |
| W24-12 | Long-press context menu (450 ms): Build here / Terraform / Move / Rally, items from feature registries, flag-gated | client | M |  | W24-11 | Long-press a Wild tile → see the menu with Terraform; with W07 off → see no Rally item | CLIENT §11 | TA-11.9 |
| W24-13 | Bottom drawer: the 4 order menus (Construction, Terraform, Units, HQ Goals) as tabs; swipe up/down; menus fed by the same registries as desktop | client | M |  | W24-08, W02-22 | Swipe the drawer up → see the four tabs; tabs of disabled waves are absent | CLIENT §11, UO-M | TA-11.9 |
| W24-14 | Tap-to-place ghost: the ghost follows the camera centre; confirm and cancel buttons; prep bill shown as a compact chip row | client | M |  | W24-13 | Pick Solar, pan, tap ✓ → see the build order queued with its prep bill | CLIENT §11, UO-TF-03 | TA-11.8 |
| W24-15 | Phone HUD layout: resource bar collapses to icons + numbers, power chip, compact event log (last 3, expandable), selection panel as a side sheet | client | M |  | W24-08 | At 844 × 390 → see every HUD element without overlap or horizontal scroll | CLIENT §11 | TA-11.7 |
| W24-16 | Phone queue panel: lane tabs, wait reason + ETA per entry, swipe to cancel with confirm | client | S |  | W24-15 | Swipe a waiting entry → see the cancel confirm; confirm → see it removed and refunded per UO-Q-02 | CLIENT §11, UO-Q | TA-11.7 |
| W24-17 | Touch accessibility: targets ≥ 44 × 44 px, contrast ≥ 4.5:1, reduced motion disables camera inertia and easing | client | S |  | W24-15 | Run the e2e axe + target-size check on the phone profile → see 0 violations | CLIENT §11 | — |
| W24-18 | Quality tier manager: auto-pick from the median frame time over the first 5 s, settings override, `localStorage` (try/catch), dev `quality.set` | client | M |  | W24-01 | Throttle the CPU 4× → see `low` picked automatically; set `high` in settings → see it kept after reload | CLIENT §9 | TA-11.9 |
| W24-19 | Phone render budget: DPR cap 1.25, `low` default on phones, post-processing (bloom, GTAO) off on `low`, shadow resolution per tier | visual | M |  | W24-18 | On the phone profile → see DPR 1.25, no bloom pass in `renderer.info`, shadows off | CLIENT §9, Pillar 4 | TA-11.9 |
| W24-20 | Entity and terrain LOD: distance-based LOD for kitbash archetypes (≤ 2 levels) and terrain chunks on `low`; draw calls ≤ 60 | visual | M |  | W24-19 | Zoom out on the phone profile → see the triangle count drop ≥ 40 % with no popping in the first ring | CLIENT §9, AGENTS.md Pillar 1 | — |
| W24-21 | Thermal/battery behaviour: cap at 30 FPS on battery saver (`navigator.getBattery` when available) or when the frame time trends up; pause the render loop when hidden; resume without reconnect | client | S |  | W24-18 | Hide the tab for 30 s and return → see rendering resume with no WS reconnect | CLIENT §11 | — |
| W24-22 | WebGL context lost/restored on phones: pause overlay, rebuild GPU resources from the WorldStore | client | S |  | W24-19 | Force `WEBGL_lose_context` → see the overlay; restore → see the scene back with no reconnect | CLIENT §12 | — |
| W24-23 | Notification deep links on phones: `/play.html?colony=…&panel=…` opens the colony and the panel; works from a PWA launch | client | S |  | W24-06 | Open the deep link `panel=queue` → see the game land with the queue panel open | CONTINUITY CT-37 | TA-11.10 |
| W24-24 | Phone perf probe in e2e (iPhone 13 / Pixel 7 emulation + optional BrowserStack run): 150 buildings + 250 robots, 20 s, median FPS ≥ 30, frame p95 logged | test | M |  | W24-19, W24-20 | Run `npm run e2e:perf -- w24` → see the median ≥ 30 FPS on both profiles | CLIENT §9 | — |
| W24-25 | Landing: split the live hero into a dynamic `import()` chunk loaded after first paint and idle; poster `<img>` as LCP | client | M |  | — | Build → see the hero chunk ≤ 200 KB gzip and the landing initial JS ≤ 50 KB gzip in the build report | CLIENT §9, D-22 | TA-12.3 |
| W24-26 | Landing poster pipeline: render the hero poster from the orbit stage (WebP + AVIF, 2 sizes) with a build script | visual | S |  | W24-25 | Run `npm run landing:poster` → see posters written and referenced with `srcset` | D-22 | TA-12.3 |
| W24-27 | Landing fallbacks: no WebGL2, `prefers-reduced-motion` or Save-Data → poster only; pause the hero when off-screen (IntersectionObserver) | client | S |  | W24-25 | Emulate reduced motion → see the poster only and no hero chunk requested | CLIENT §11 | TA-12.3 |
| W24-28 | Live planet stats: `GET /v1/public/stats` (active planets, colonies, Living tiles), 60 s cache, numbers in the landing hero band | server | S |  | W24-01 | Open the landing → see live counts that match the dev console `stats` output | CLIENT §3 | TA-12.1 |
| W24-29 | Landing CTA: "Play now" → `/play.html` guest boot; "Resume colony" when a session cookie exists | client | S |  | W24-28 | Click "Play now" in a fresh browser → see the guest boot flow start | CLIENT §3 | TA-12.1 |
| W24-30 | Landing SEO/meta, Open Graph image (from the poster), legal placeholders (privacy, terms), analytics opt-in banner | client | S |  | W24-26 | Run Lighthouse SEO → see ≥ 95 and the OG image resolving | CLIENT §10 | TA-12.2 |
| W24-31 | Landing responsive QA: 360 px to 3840 px, no horizontal scroll, touch-friendly roadmap and resource tabs | test | S |  | W24-25 | Run the e2e viewport sweep → see no horizontal scroll at any width | CLIENT §11 | TA-12.1 |
| W24-32 | Device QA matrix doc + e2e profiles: desktop Chrome/Edge/Firefox/Safari, iOS Safari + PWA, Android Chrome, iPad best effort; known-issues list | docs | S |  | W24-24 | Open `docs/plan/waves/W24-device-matrix.md` → see every profile with pass/fail and a date | CLIENT §11 | — |
| W24-33 | Analytics events `rotate_prompt_shown`, `fullscreen_entered`, `pwa_installed`, `quality_tier_set`, `landing_hero_loaded`, `landing_cta_clicked` | client | S |  | W24-04, W24-29 | Install the PWA on the emulator → see `pwa_installed` in the dev analytics log | CLIENT §10 | — |
| W24-34 | Wave e2e `e2e/w24.spec.ts` (phone + landing) + scenario `w24-mobile` (150 buildings, 250 robots, mixed queue) + tag `wave-24` | test | M |  | W24-02 … W24-33 | Run `npm run e2e -- --waves ..24` → see the demo story pass and every earlier suite still green | PRODUCT_WAVES §3 | — |

## Wave DoD

- `e2e/w24.spec.ts` passes on the phone profiles and the landing, and every earlier wave's e2e still passes.
- `?scenario=w24` loads.
- With `TA_WAVES=..23` the game behaves as desktop-only (no rotate prompt, drawer or install prompt) and the landing hero keeps its current behaviour.
- The phone perf probe is ≥ 30 FPS, and the landing bundle budgets are green in the build report.
- Tag `wave-24` exists.
- Every row of the features table is covered by a closed issue.
