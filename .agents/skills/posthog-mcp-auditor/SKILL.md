---
name: posthog-mcp-auditor
description: >
  Run a Graph -> Loop verification and reconciliation pass against PostHog using Model Context Protocol (MCP)
  tools (`dashboards-get-all`, `dashboard-create`, `insight-create-from-query`, `query-run`).
  Double-checks that every page, in-game button/HUD panel, conversion funnel, view trend, country breakdown,
  and retention view exists and evaluates cleanly in PostHog.
---

# PostHog MCP Graph -> Loop Auditor (`posthog-mcp-auditor`)

Combines the codebase UI/Button Graph (`posthog-surface-scanner`) with an iterative **Loop** that observes, reconciles, and double-checks PostHog via **MCP JSON-RPC 2.0**.

## Architecture (`Graph -> Loop`)

1. **Graph**: Scan `frontend/` + `shared/contracts/src/analytics/` -> build `Surface -> Area/HUD -> Button -> Event -> Insight -> Dashboard` graph and validate starter completeness (views, conversions, countries, in-game buttons, retention, errors).
2. **Loop (1..N rounds)**:
   - Connect to PostHog MCP (`posthog-mcp-server.mjs` or remote `https://mcp.posthog.com/mcp` via `mcp-remote`)
   - Observe live state (`dashboards-get-all`, `insights-get-all`)
   - Reconcile drift (`dashboard-create`/`dashboard-update`, `insight-create-from-query`/`insight-update` when `--apply`)
   - Double-check tiles & execute live queries (`dashboard-get`, `query-run`) until drift is 0.

## Usage

```bash
npm run analytics:loop                                     # Graph check + plan (safe without personal key)
npm run analytics:loop -- --mock                           # Full Graph -> Loop -> MCP apply & verify against local mock PostHog
npm run analytics:loop -- --apply                          # Live Graph -> Loop apply & MCP double-check via local MCP
npm run analytics:loop -- --verify                         # Live read-only MCP double-check via local MCP
npm run analytics:loop -- --mcp-mode remote --verify       # Live read-only Graph -> Loop against official PostHog Remote MCP (`https://mcp.posthog.com/mcp`)
npm run analytics:loop -- --mcp-mode remote --apply        # Live Graph -> Loop apply & double-check via official PostHog Remote MCP
npm run analytics:mcp                                      # Launch official PostHog remote MCP stdio bridge using infra/.env.posthog
npm run analytics:mcp -- --print-wizard                    # Print safe `npx @posthog/wizard mcp add` command for user-level IDE setup
npm run analytics:mcp -- --wizard                          # Run `npx @posthog/wizard mcp add` with credentials from infra/.env.posthog
```

## Official PostHog MCP (`npx @posthog/wizard mcp add`)

`https://mcp.posthog.com/mcp` (the remote MCP installed by `npx @posthog/wizard mcp add`) uses PostHog's single `exec` CLI-gateway tool (`switch-project`, `dashboards-get-all`, `dashboard-get`, `dashboard-create`, `dashboard-update`, `insights-list`, `insight-get`, `insight-create`, `insight-update`, `insight-query`, `dashboard-insights-run`). `mcp-adapter.mjs` automatically translates between the local stdio MCP (`posthog-mcp-server.mjs`) and the official remote `exec` protocol. `launch-remote-mcp.mjs --wizard` passes `POSTHOG_WIZARD_API_KEY` via process environment (never CLI argv). Keep IDE MCP configs user-scoped (`~/.claude.json`, `~/.cursor/mcp.json`) and never commit tokens or a root `.mcp.json` (`D-41`).
