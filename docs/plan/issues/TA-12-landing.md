# Epic TA-12 — Landing (`frontend/landing`, `terraagent.com`)

> **Orchestrator:** [`EXECUTION_ORCHESTRATOR.md`](../EXECUTION_ORCHESTRATOR.md) · **Status Board:** [`STATUS.md`](../STATUS.md)
> **Spec:** [`ARCHITECTURE.md`](../../spec/ARCHITECTURE.md) §3, §4 · [`CLIENT.md`](../../spec/CLIENT.md) §9 (budgets), §10 (analytics & consent), §14 (open question 5) · [`docs/game/autonomous-colony-spec.md`](../../game/autonomous-colony-spec.md) §1, §13
> **Lane:** `L5` Clients & Infra. Owned path: `frontend/landing/**`.

## Overview

`terraagent.com` is a fast static Vite site. It explains the game (drop a founder robot, the colony runs itself, an AI director decides, launch rockets to new planets, the chain stays invisible), shows live proof that the world is running (planets and colonies online), and sends visitors to `game.terraagent.com`. It also carries SEO/OG metadata, legal placeholders, and the shared cross-subdomain consent banner.

## Epic analytics

- **Goal / user value:** a visitor understands "an autonomous colony that keeps playing while you're away" in under 10 seconds and clicks Play.
- **Success metrics:**
  - LCP ≤ 2.0 s p75 (4G desktop).
  - JS ≤ 50 KB gzip, CLS ≤ 0.05.
  - Lighthouse Performance/Accessibility/SEO ≥ 90.
  - landing_view → play_click CTR ≥ 8 % (opt-in sample).
- **In scope:**
  - Hero (poster + loop video), "how it works" loop, planet types, AI director, invisible NEAR blurb.
  - CTAs, live stats, SEO/OG, sitemap/robots, `/privacy` and `/terms` placeholders.
  - The consent banner shared with the game.
- **Out of scope:**
  - Blog/CMS, i18n beyond EN, newsletter capture, a live Three.js hero (open question 5 in CLIENT.md).
- **Key risks:**
  - Video weight hurting LCP. Mitigation: a poster image is the LCP element and the video is lazy.
  - The live stats endpoint not owned by any core task (see TA-12.1 DoR).

## Architecture overview

```mermaid
flowchart LR
  V["Visitor"] --> N["nginx terraagent.com (static dist)"]
  N --> L["landing index.html + ~50 KB JS"]
  L -->|GET /v1/planets/stats (60 s cache)| API["api.terraagent.com (core)"]
  L -->|consent=1 → POST /v1/analytics/events| API
  L -->|CTA ?src=landing&cta=hero| G["game.terraagent.com"]
  L -. "ta_consent cookie Domain=.terraagent.com" .-> G
```

Source layout (target): `frontend/landing/{index.html, privacy/index.html, terms/index.html, vite.config.ts, public/{og.png, poster.webp, hero.mp4, robots.txt, sitemap.xml, favicon.svg}, src/{main.ts, stats.ts, consent.ts, analytics.ts, styles.css}, test/}`.

## Task index

| Task | Title | Wave / Lane | Depends On |
|---|---|---|---|
| `TA-12.1` | Landing page: hero, loop explainer, CTA, live planet stats | W1 / L5 | TA-01.1 |
| `TA-12.2` | Landing SEO/meta, legal placeholders, analytics opt-in | W4 / L5 | TA-12.1, TA-11.1 |
| `TA-12.3` | Live Three.js mini-diorama hero with lazy load + static poster fallback (D-22) | W5 / L5 | TA-12.1, TA-14.9 |

---

## Tasks

### `TA-12.1` — Landing page: hero, loop explainer, CTA, live planet stats

- **Status:** `[ ] Todo`
- **Wave / Lane:** `W1 / L5`
- **Depends On:** `TA-01.1`
- **Spec:** [`ARCHITECTURE.md`](../../spec/ARCHITECTURE.md) §4 · [`CLIENT.md`](../../spec/CLIENT.md) §9, §10.3 (`landing_view`, `play_click`) · [`docs/game/autonomous-colony-spec.md`](../../game/autonomous-colony-spec.md) §1, §5, §9, §10, §13
- **Target Files:**
  - `frontend/landing/package.json`, `frontend/landing/vite.config.ts`, `frontend/landing/index.html`, `frontend/landing/.env.example`
  - `frontend/landing/src/{main.ts,stats.ts,styles.css}`
  - `frontend/landing/public/{poster.webp,hero.mp4,favicon.svg}`
  - `frontend/landing/test/{stats.test.ts,build-budget.test.ts}`, `frontend/landing/eslint.config.mjs`
- **Verify:** `npm run test -w @terra/landing && npm run build -w @terra/landing`

#### Analytics
- **Problem & goal:**
  - The project needs a public front door at `terraagent.com` that sells the core loop and the "keeps playing without you" promise, and moves visitors to the game in one click.
  - Live stats prove the world is persistent and online.
- **Constraints:**
  - Static output served by nginx (TA-02.4); no SSR.
  - ≤ 50 KB JS gzip (CLIENT.md §9).
  - Works with JS disabled (CTA is a plain link; stats are progressive enhancement).
  - The stats API must not block rendering.
  - Brand visuals must follow the palette (`docs/visuals/agent-3d-coding-rules.md` §2) so landing and game feel like one product.
- **Risks → mitigations:**
  - Hero video weight hurting LCP. `poster.webp` (≤ 120 KB) is the LCP element; `hero.mp4` (≤ 2.5 MB, H.264, muted, `preload="none"`) loads after `load`, and `prefers-reduced-motion` keeps the poster.
  - The stats endpoint being down. Hide the stats block on any error or timeout (> 1.5 s); never show zeros.
  - Stats leaking sensitive data. Aggregate counts only.
- **Alternatives rejected:**
  - A React landing: unnecessary JS.
  - A live Three.js hero: about 160 KB plus GPU on a marketing page (open question 5).
  - Fetching stats via the game app: couples deploys.
- **Telemetry (proves it works):** `landing_view`, `play_click {cta_id}` (opt-in, wired in TA-12.2; the hooks exist here as no-ops); a build budget report; a Lighthouse CI score in the PR.

#### Architecture
- Sections:
  1. Hero: headline "Your colony keeps building while you sleep", subline, primary CTA `Play now`, a secondary "How it works" anchor.
  2. Core loop in 4 steps: drop founder → colony automates → AI director decides → launch rockets.
  3. Planet types (Temperate, Desert) with hazard and resource blurbs.
  4. "Play together, even offline": persistent planets with up to 5 colonies, and new planets for new players.
  5. "Chain is invisible": a NEAR blurb.
  6. Live stats.
  7. Footer: privacy, terms, socials placeholder.
- CTA: `https://game.terraagent.com/?src=landing&cta=<id>`. The dev URL is from `VITE_GAME_URL`.
- `stats.ts`: `fetch(VITE_API_URL + "/v1/planets/stats")` with a 1.5 s `AbortController`, parsed with the zod `PlanetStatsV1 { planetsActive, coloniesAlive, playersOnline, updatedAt }` (MATCHMAKING §4) from `@terra/contracts`. It renders counters and refreshes every 60 s while visible.
- CSS: hand-written + CSS variables (palette tokens), with a dark theme default.

#### Definition of Ready (DoR)
- [ ] Brand copy draft approved by the owner (or the placeholder copy above accepted).
- [ ] `GET /v1/planets/stats` (`PlanetStatsV1`, public, cached 10 s) is owned by TA-05.2 (W2); until it is merged the stats block is hidden behind `VITE_STATS_ENABLED=0`.
- [ ] Poster image and loop video assets exist. Until the game renders, use a placeholder render of the TA-11.5 `/inspect` diorama.

#### Definition of Done (DoD)
- [ ] `build-budget.test.ts`: `dist` JS ≤ 50 KB gzip, CSS ≤ 20 KB gzip, `poster.webp` ≤ 120 KB, `hero.mp4` ≤ 2.5 MB.
- [ ] `stats.test.ts`: renders counts from a fixture; hides on 404, 500, timeout and schema error; no layout shift (the block has reserved height or is inserted below the fold).
- [ ] CTAs work without JS (plain `<a href>`). The page is keyboard-navigable and has `alt` text on all imagery.
- [ ] Lighthouse (mobile + desktop) Performance, Accessibility and SEO ≥ 90 on `vite preview`. The report is attached to the PR.
- [ ] Status synced in orchestrator, issue file and STATUS.md (§1.6).

---

### `TA-12.2` — Landing SEO/meta, legal placeholders, analytics opt-in

- **Status:** `[ ] Todo`
- **Wave / Lane:** `W4 / L5`
- **Depends On:** `TA-12.1`, `TA-11.1` (shared consent/analytics semantics)
- **Spec:** [`CLIENT.md`](../../spec/CLIENT.md) §10 (`CL-11`) · [`ARCHITECTURE.md`](../../spec/ARCHITECTURE.md) §4 (CSP)
- **Target Files:**
  - `frontend/landing/index.html` (meta, OG, Twitter, JSON-LD `VideoGame`)
  - `frontend/landing/public/{og.png,robots.txt,sitemap.xml}`
  - `frontend/landing/privacy/index.html`, `frontend/landing/terms/index.html`
  - `frontend/landing/src/{consent.ts,analytics.ts}`
  - `frontend/landing/test/{consent.test.ts,seo.test.ts}`
  - `tests/e2e/journeys/consent.spec.ts`
- **Verify:** `npm run test -w @terra/landing && npm run build -w @terra/landing && npm run test:e2e -- --grep @consent`

#### Analytics
- **Problem & goal:**
  - Make the landing discoverable and shareable (search snippets, link previews).
  - Provide legally required pages (placeholders until the owner supplies text).
  - Start measuring the top of the funnel, `landing_view → play_click`, but only with explicit opt-in that also carries over to the game subdomain.
- **Constraints:**
  - Off by default (`CL-11`). One consent choice for `terraagent.com` and `game.terraagent.com` (cookie `ta_consent`, `Domain=.terraagent.com`).
  - No third-party scripts.
  - A strict CSP: only `connect-src https://api.terraagent.com` is added.
  - Legal text is owner-provided (`OWNER_TASKS.md`).
- **Risks → mitigations:**
  - Consent mismatch between subdomains. Both apps share the same cookie names and semantics. An e2e test checks that a landing opt-in is visible in the game.
  - Banner hurting CLS. It is a fixed-position bottom bar that does not shift content.
  - Placeholder legal pages shipped as final. They carry a visible "Draft" banner, and TA-13.7 blocks launch until the owner replaces them.
- **Alternatives rejected:**
  - Google Analytics or Meta pixel: third-party data and a cookie-law burden.
  - Implied consent: violates `CL-11`.
- **Telemetry (proves it works):** `landing_view {utm_*, referrer_host}` and `play_click {cta_id}` sent to `POST /v1/analytics/events` only after consent; the e2e test asserts zero analytics requests before consent.

#### Architecture
- `<head>`:
  - title and description;
  - canonical `https://terraagent.com/`;
  - OG (`og:title`, `og:description`, `og:image` 1200×630 `og.png`, `og:url`) and `twitter:card=summary_large_image`;
  - JSON-LD `VideoGame` (`name`, `genre`, `gamePlatform: Web browser`, `url`).
- `robots.txt` allows all and points to the `sitemap.xml` (`/`, `/privacy/`, `/terms/`).
- `consent.ts` has the same API as the game (`getConsent()`, `setConsent(bool)`, `onChange`):
  - it writes `ta_consent=analytics:1|0` with `Domain=.terraagent.com; Max-Age=15552000; SameSite=Lax; Secure` (host-only on localhost);
  - on withdrawal it deletes `ta_aid`.
- `analytics.ts` creates `ta_aid` only after consent and batches to `POST /v1/analytics/events` (`AnalyticsBatchV1`), flushing via `sendBeacon` on `pagehide`. `play_click` is sent via `sendBeacon` before navigation.
- Footer link "Privacy settings" reopens the banner.

#### Definition of Ready (DoR)
- [ ] `AnalyticsBatchV1` and `POST /v1/analytics/events` are in contracts and the endpoint is owned by TA-04.7 (W4 / L1, same wave — contract-only coupling).
- [ ] Owner-provided or approved placeholder legal text for privacy and terms.
- [ ] The CSP header set in TA-02.4 allows `connect-src https://api.terraagent.com`.

#### Definition of Done (DoD)
- [ ] `seo.test.ts` parses the built `index.html`: title ≤ 60 chars, description ≤ 160, canonical present, OG and Twitter tags present, `og.png` 1200×630, JSON-LD valid; `robots.txt` and `sitemap.xml` exist and contain 3 URLs.
- [ ] `consent.test.ts`: default off; no `ta_aid` before opt-in; withdrawal deletes `ta_aid`; the cookie domain is correct for prod vs localhost.
- [ ] E2E `consent.spec.ts` `@consent`, on the local nginx stack (`*.terraagent.localhost`): zero `/v1/analytics/events` requests before consent; after opt-in on the landing, the game at `game.terraagent.localhost` sees consent and sends `planet_picker_view`.
- [ ] `/privacy/` and `/terms/` are reachable, carry the "Draft" banner, and are linked from the footer and the game Settings.
- [ ] Status synced in orchestrator, issue file and STATUS.md (§1.6).

---

### `TA-12.3` — Live Three.js mini-diorama hero with lazy load + static poster fallback (D-22)

- **Status:** `[ ] Todo`
- **Wave / Lane:** `W5 / L5 (first W5 L5 task)`
- **Depends On:** `TA-12.1`, `TA-14.9`
- **Spec:** [`CLIENT.md`](../../spec/CLIENT.md) §9, §14 Q5 (answered: live diorama); [`DECISIONS.md`](../../spec/DECISIONS.md) D-22; [`AGENTS.md`](../../../AGENTS.md) Pillar 4
- **Target Files:**
  - `frontend/landing/src/hero/{diorama.ts,scene.ts,poster.webp}`
  - `frontend/landing/test/hero.spec.ts`
- **Verify:** `npm run build -w @terra/landing && npm run test -w @terra/landing -- hero && npm run lighthouse -w @terra/landing`

#### Analytics
- **Problem:** the owner chose a live diorama over a video. LCP must not regress.
- **Constraints:** a static poster paints first; the diorama (≤ 160 KB gz) loads after `load`/idle and is skipped when `prefers-reduced-motion` is set or on low-end devices.
- **Telemetry:** `hero_mode{live|poster}`.

#### Architecture
- Reuses the kitbash archetypes from TA-14.9: a Hub, a few drones, a wall ring and a terraformed patch on a turntable.

#### Definition of Ready (DoR)
- [ ] `TA-14.9` archetypes merged.

#### Definition of Done (DoD)
- [ ] Lighthouse mobile LCP ≤ 2.5 s with the poster; the diorama swaps in without layout shift (CLS < 0.05).
- [ ] Status synced in orchestrator, issue file and STATUS.md (§1.6).
