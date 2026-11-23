---
name: posthog-surface-scanner
description: >
  Scan TerraAgent's frontend HTML entries, TypeScript AST, Faction Plate buttons, and HUD registries
  to produce a UI/Button Analytics Graph (`pages -> buttons -> events -> funnels -> dashboards`)
  and auto-generate PostHog insights for every surface and in-game control.
---

# PostHog Surface & Button Scanner (`posthog-surface-scanner`)

Parses `frontend/` and `shared/contracts/src/analytics/` to understand every public page, button, CTA, tab, and in-game HUD/control module (`CommandDock`, `ColonyBook`, `ConstructionMenu`, `UnitsMenu`, `TerraformMenu`, `OrbitalArHud`, `PauseOverlay`, `QueuePanel`, `ArmyStancePanel`, `Diplomacy`, `Bounty`, `TradeHub`, `TradePage`, `MePage`, `Landing`, `Whitepaper`, `PitchDeck`, `Deed`, `Design`, `Playground`).

## Usage

```bash
npm run analytics:scan                 # human-readable UI graph & coverage summary
npm run analytics:scan -- --json       # full nodes/edges graph + auto-generated insight specs
npm run analytics:scan -- --check      # fail if any public page is unbooted or any UI matcher in uiRules.ts/ui.ts is dead
```

## Outputs

- `surfaces`: every public HTML page and its `bootProductAnalytics('<surface>')` wiring
- `controls`: discovered UI controls, HUD dock/colony tabs, and game actions mapped to catalog events
- `matchers`: verified DOM matcher inventory (`TESTID_MATCHERS`, `ID_MATCHERS`, `ACTION_MATCHERS`) with dead-selector detection
- `graph`: `{ nodes, edges }` connecting surfaces -> controls -> events -> funnels/trends -> dashboards
- `autoFunnels` & `autoTrends`: dynamically generated PostHog conversion funnels and breakdowns derived from scanned game buttons
