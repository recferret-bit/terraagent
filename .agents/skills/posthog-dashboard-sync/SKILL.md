---
name: posthog-dashboard-sync
description: >
  Compile TerraAgent analytics catalogs and scanned UI button graphs into PostHog InsightVizNode
  dashboards (Executive/Views/Countries, Gameplay/HUD Buttons, Trading/Web3/Profile, Health/Errors),
  idempotently sync them via PostHog REST API, and check deployment & credential safety.
---

# PostHog Dashboard Sync & Deploy Readiness (`posthog-dashboard-sync`)

Reads credentials safely from `infra/.env.posthog` (never printed, never committed) and compiles `shared/contracts/src/analytics/` + `posthog-surface-scanner` into live PostHog dashboards and insights.

## Usage

```bash
npm run analytics:sync                       # dry-run: compile dashboards & insights and print plan
npm run analytics:sync -- --apply            # idempotently create/update dashboards & insights in PostHog
npm run analytics:sync -- --verify           # read back PostHog dashboards & insights and check drift
npm run analytics:deploy-check               # verify gitignore, zero frontend token leaks, nginx proxies, deploy config
```

## Required `.env.posthog` keys

- `project_token` (`phc_...`) — server ingestion token (used by backend relay `POSTHOG_KEY`)
- `project_id` — PostHog numeric project id
- `region` — `eu` or `us` (maps to `eu.posthog.com` / `eu.i.posthog.com` or `us.posthog.com` / `us.i.posthog.com`)
- `personal_api_key` (`phx_...`, or `project_api_key` when set to `phx_...`) — **required for `--apply` / `--verify` / MCP** (`dashboard:write`, `insight:write`, `query:read`)
- `person_salt` — optional HMAC salt for `$identify`
