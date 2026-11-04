# W16 director load report

Measured 2026-11-04 by `loadReport(50)` in `backend/director/src/bench.ts`.

| Field | Value |
|---|---|
| Hardware | Apple M5 Pro, arm64, 18 cores, 48 GB |
| Samples | 50 summaries of a 450-sector synthetic world |
| p95 | 0.014 ms |
| RSS | 145 MB |
| Pool | in-memory 1 (the bench does not open pg-boss or Postgres) |
| Oldest job age | 0 ms |

This is the bounded summary path only. It is not a saturated multi-worker game host. A Postgres pool measurement waits until the director worker claims jobs from pg-boss on a running database.
