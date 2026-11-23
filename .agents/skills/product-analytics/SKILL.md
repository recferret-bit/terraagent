---
name: product-analytics
description: >
  Build and check TerraAgent's product analytics: consented visitor counts, PostHog funnels
  (landing, sign-in by Google / X / wallet, planet, trade, gameplay, profile), and the failure
  reason on every broken step. Use when asked to add a funnel, instrument a page, check analytics,
  audit PostHog, or /product-analytics. The catalog in shared/contracts is the source of truth.
---

# Product analytics

The catalog owns event names, props, funnels, and trends. Do not copy that list into this skill or into a second table.

Read both files before adding anything:

- `shared/contracts/src/analytics/catalog.ts` — `ANALYTICS_EVENTS`, planes, props, `clientMaySend`
- `shared/contracts/src/analytics/funnels.ts` — `ANALYTICS_FUNNELS`, `ANALYTICS_TRENDS`

Order is fixed: add the name in the catalog, then an emitter, then `npm run validate:analytics`. A string that is not in the catalog is not an event.

## Two planes

- `client`, and the client half of `both`, fire in the browser through `track` from `frontend/game/core/analytics`. `track` is a no-op until the cookie `ta_consent=analytics:1`.
- `server`, and the server half of `both`, fire only after a commit, through the recorder in `backend/app/src/analytics/`. The public intake drops server-plane names (`clientMaySend`).

## Visitors

- Consented people are unique `anonId` values on `surface_viewed`. PostHog math is `dau`, breakdown `surface`, filter `runtime=prod` (the pinned `visitors` trend).
- Every load, including a refusal, is the cookieless counter `ta_surface_views_total` (`POST /v1/analytics/surface`, labels `surface` and `consent`).
- The gap between those two is the consent rate.
- Do not store an IP or a user agent. Do not create the anon cookie before consent.

## Identity

On a consented sign-in the browser sends `x-terra-anon` and `x-terra-wallet`. The server emits `auth_completed`. Only when `POSTHOG_PERSON_SALT` is set, it also sends `$identify`: `distinct_id` is an HMAC of the player id, and `$anon_distinct_id` is the anon uuid.

Never put the player id, account id, email, address, or token in properties. Do not use `$create_alias` (the field order is a known trap). Without the salt, one browser still joins because `distinct_id` stays the anon id.

## Failures

Every `*-fail` funnel excludes the success event and breaks down by `reason`. A new failure reason is a new closed value in the catalog. The harness requires that literal in the emitting tree. Do not send raw error strings.

## PostHog

No `posthog-js` in the browser, and no `posthog.com` script URL. The server relays to `{POSTHOG_HOST}/batch/` (default `https://eu.i.posthog.com`) only when `POSTHOG_ENABLED` is the exact string `true`, `POSTHOG_KEY` is a project token, and `POSTHOG_DISABLED` is not `true`. The string `1` does not enable the flag. Never print the key. Anonymous captures set `$process_person_profile` false.

On HTTP requests behind `terra-nginx` (`TA_TRUST_PROXY=1`), `backend/app/src/analytics/geo-context.ts` extracts transient public client IP (`$ip`) and optional edge country header (`$geoip_country_code` / `$geoip_country_name`) in memory ONLY for PostHog GeoIP resolution — never stored in Postgres and never logged.

Probe traffic uses `surface=probe` or `runtime=local`. Pinned insights filter `runtime=prod`.

Do not create or edit a PostHog dashboard unless the user says to apply (`npm run analytics:sync -- --apply` or `npm run analytics:loop -- --apply`). The base validator harness does not call PostHog.

## Superset of Analytics Skills

- `product-analytics` — catalog, emitters, closed failure reasons, public page & vhost coverage (`npm run validate:analytics`, `npm run test:analytics`)
- `posthog-surface-scanner` — AST + HTML scanner mapping every page, button, CTA, and in-game HUD tab into a UI graph and auto-generated insights (`npm run analytics:scan`)
- `posthog-dashboard-sync` — PostHog REST API compiler & idempotent dashboard/funnel sync (`npm run analytics:sync`, `npm run analytics:deploy-check`)
- `posthog-mcp-auditor` — Graph -> Loop verification & reconciliation engine backed by PostHog MCP tools (`npm run analytics:loop`)

## Check

```bash
npm run validate:analytics   # catalog wiring, emitters, reason literals, page/vhost coverage, no browser PostHog
npm run test:analytics       # harness self-test on fixtures
npm run analytics:scan       # build UI & button graph and verify button/surface coverage
npm run analytics:sync       # dry-run PostHog dashboard/funnel compilation (add --apply for live)
npm run analytics:loop       # Graph -> Loop + PostHog MCP verification pass
npm run analytics:deploy-check # verify secrets hidden from git/dist, nginx proxies, and server env readiness
```

`validate:analytics` is the check. Exit 1 prints one failure per line. Do not weaken it so a half-wired tree passes. Server steps may omit `runtime`. Legacy names must still be quoted somewhere in non-test `frontend/` or `backend/app/src`.

## Limits

Files ≤ 500 lines. Functions ≤ 100 lines. New chrome uses Faction Plate (`--ta-*`, chamfer, no `border-radius`).
