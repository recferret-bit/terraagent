---
name: api-atlas
description: >
  Regenerate the TerraAgent HTTP and WebSocket API atlas (expandable HTML+CSS with schemas and client connections).
  Use when the user says "api atlas", "regenerate the api map", "document the apis", "/api-atlas", or asks for a page of HTTP and socket schemas.
---

# API atlas

Regenerate the catalog. Do not hand-edit `frontend/dev/api-atlas/index.html` or `frontend/dev/api-atlas/atlas.css`.

```bash
npm run api:atlas
```

The generator overwrites both files from Nest controllers (`backend/app/src/**/*.controller.ts`, global prefix `/v1`), `shared/contracts/schema/contracts.schema.json` (`clientMessages`, `serverMessages`, `commands`, `events`), and frontend call sites.

Served at http://127.0.0.1:5173/dev/api-atlas/ while `npm run dev` is running. Hub link: `/dev/api-atlas/`.
