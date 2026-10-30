# TerraAgent docs

Everything that is not code lives here. The repo root only keeps `README.md`, `AGENTS.md` and `CLAUDE.md`.

| Folder | What it holds | Start with |
|---|---|---|
| [`game/`](./game) | **Game design:** the concept, the economy and buildings, units and orders, and the NEAR economy features | [`autonomous-colony-spec.md`](./game/autonomous-colony-spec.md) |
| [`spec/`](./spec) | **Online architecture** for the server, protocol, client, NEAR and deployment, plus the browser tech stack. `DECISIONS.md` is the source of truth for what was decided | [`DECISIONS.md`](./spec/DECISIONS.md) |
| [`plan/`](./plan) | **Build plan:** 26 product waves (862 issues, one file per wave), the hackathon cut (`H` tags) and its generated schedule | [`PRODUCT_WAVES.md`](./plan/PRODUCT_WAVES.md), [`HACKATHON_CUT.md`](./plan/HACKATHON_CUT.md) |
| [`visuals/`](./visuals) | **3D and rendering rules** for agents and artists: coding rules, the AI-mesh pipeline, procedural textures, shaders and lighting | [`agent-3d-coding-rules.md`](./visuals/agent-3d-coding-rules.md) |

## Game design (`game/`)

| File | Contents |
|---|---|
| [`autonomous-colony-spec.md`](./game/autonomous-colony-spec.md) | The original game concept and loop |
| [`colony-economy-and-buildings-spec.md`](./game/colony-economy-and-buildings-spec.md) | Resources, 3-tier buildings, power grid, territory, balance tables |
| [`units-orders-and-progression-spec.md`](./game/units-orders-and-progression-spec.md) | Unit roster, order lanes, ground preparation, the staged learning curve (decision D-16) |
| [`near-economy-features-spec.md`](./game/near-economy-features-spec.md) | NEAR features F1 to F8: cargo tokens, player markets, NPC traders, colony agent (decision D-26) |

## Online architecture (`spec/`)

`ARCHITECTURE`, `SIMULATION`, `PROTOCOL`, `CLIENT`, `NEAR`, `AI_ORCHESTRATOR`, `CONTINUITY`, `MATCHMAKING`, `DATA_MODEL`, `DEPLOYMENT` and `DECISIONS` cover the planned backend. [`tech-stack-spec.md`](./spec/tech-stack-spec.md) covers the browser 3D stack.
Several files describe the earlier multi-service design that decision D-24 simplified to one Node app. Check `DECISIONS.md` before relying on a detail.

## 3D and rendering (`visuals/`)

| File | Contents |
|---|---|
| [`agent-3d-coding-rules.md`](./visuals/agent-3d-coding-rules.md) | Mandatory rules and reference code for any agent writing Three.js, shaders or procedural models |
| [`ai-3d-visuals-and-models-spec.md`](./visuals/ai-3d-visuals-and-models-spec.md) | Why AI meshes look bad and the pipeline that fixes it |
| [`textures-shaders-lighting-spec.md`](./visuals/textures-shaders-lighting-spec.md) | Procedural PBR textures, terrain and water shaders, day/night lighting, lightning |

The short, enforced version of these rules is in [`AGENTS.md`](../AGENTS.md) and the skills under [`.agents/skills/`](../.agents/skills).
