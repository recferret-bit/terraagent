# Owner tasks — things agents cannot do

> Checklist of accounts, keys, infrastructure and decisions only the owner can provide. Each item names the wave that needs it. Agents mark an item `[!] Blocked` in their task when it is missing and continue with mocks.

## Owner answers recorded (2026-10-29)

- [x] Open questions from every spec answered. The answers are recorded as **D-16 (Accepted)** and **D-17..D-23** in [`../spec/DECISIONS.md`](../spec/DECISIONS.md), plus D-12 (amended) and D-09 (confirmed). See the answered grill list at the bottom.

## Before 2026-11-01 — hackathon (D-27, [`HACKATHON_CUT.md`](./HACKATHON_CUT.md))

> **D-30 changes the timing.** Phase 1 (D1–D10) runs every NEAR feature on mock adapters, so no NEAR item below blocks D1–D10. You need:
> - the **social-login provider** and a funded **relayer account** by **D11 (11-11)**: real F5;
> - the **mainnet dev accounts + small balance** and the cargo-contract deployer by **D12 (11-12)**: real F1/F2.
>
> If they are missing, the demo ships on mocks (`NEAR_ALLOW_MOCK_IN_PROD=true`) and the README says so.

- [ ] **Public GitHub repo + LICENSE.** The repo exists (`github.com/recferret-bit/terraagent`, `main` pushed 2026-10-30). Make sure it is **public** (judges cannot open private ones) and add a `LICENSE` file before 11-01, so the pre-window baseline (the `frontend/` prototype) is on record.
- [ ] **Mainnet dev accounts + a small NEAR balance** for NEAR Intents testing (`intents.near` has no testnet): e.g. `dev-a.terraagent.near` and `dev-b.terraagent.near`, plus the server port account for minting (`res.terraagent.near` deployer). A few NEAR is enough; mainnet costs are not reimbursed.
- [ ] **1Click partner JWT** (optional): register at `partners.near-intents.org` to avoid the 0.2 % fee without a JWT.
- [ ] **Pick a social-login provider** for F5 (HOT is a listed hackathon partner; check the others for NEAR named-account support). Fallback: guest + server-created custodial sub-accounts.
- [ ] **Prize payout wallet:** a **mainnet** NEAR account owned by you (the submission form asks for it).
- [ ] **X account** for the required demo post ("built at NEAR HACKATHON" + video).
- [ ] **4 vCPU / 8 GB host** ready for the hosted demo. DNS and the SSH key are the "Before W3" list below (D-37). A local-only demo is the fallback. Cloudflare is not required.

## Plan review 2026-10-30 — questions for the owner

The wave plan was reviewed against the specs and the existing `frontend/` prototype (layout decision D-32). Agents follow the **proposed default** until you answer; change it here and in the named issue.

**Blocking the hackathon path (`H` rows)**

| # | Question | Proposed default | Where |
|---|---|---|---|
| R1 | Planet types vs client looks | **Answered 2026-10-30 → D-33:** three types as on the landing page: Desert (`dune`), Ocean (`oceanForest`), Temperate (`forestRock`) | W01 header, W05-17, W11-01 |
| R2 | Resource names | **Answered 2026-10-30 → D-34:** Metals, Minerals, Bio with T1/T2/T3 sub-resources (T2/T3 after terraforming: colony threshold and terraformed deposit ground); Energy is grid power | W02-26 and every cost row |
| R3 | Existing models fail the validator (`robot.hero` ≈ 12.7 k tris, `building.commandHub` ≈ 11.5 k, `mine` 24 errors, `pylon` 16, `wind` 6, `rocket` 10.5 k). Fix inside the binding rows (sized M) or accept them for the demo and move the clean-up to `H+`? | Fix inside the binding rows (as planned). Only W01-24 and W01-25 are `H` (2 units); the rest are already `H+` or later | W01-24, W01-25, W02-18, W03-21..23, W21-20 |
| R4 | The existing descent cinematic lasts ≈ 35 s; the sim's pod phase is 6 s (`podDescentS`) | 6 s in the sim; the cinematic sync is W01-23 (`H+`); until then the HQ appears while the pod still falls on screen | W01-09, W01-23 |
| R5 | Look of the hex terrain | Smooth relief from the sim's tiles + thin hex edge lines (CLIENT §8 decides the source, not the look) | W00-28, W01-20 |
| R6 | Trade Hub is the only new archetype on the `H` path. Keep it `H`, or a placeholder at `H` and the model at `H+`? | Keep `H` | W10-16 |
| R7 | Guild ship moved `H` → `H+` and reuses `ship.carrier` | Accept | W15-14 |
| R8 | `powerOverload` debounce: SIMULATION §7.4 says 600 ticks (120 s), §9 says 60 s | 600 ticks (§7.4); fix §9 when confirmed | W03-06 |
| R9 | Petroleum Well unlocks at S2 but yields only `bio.t2`, which needs Terraform ≥ 30 % + a terraformed ring (D-34) | Move its unlock to S5 with the other T2 items (W03-30 is `H+`) | units spec stage table, W03-30 |
| R10 | Hub T2 (the S5 trigger) now costs T2 sub-resources, so S5 needs Terraform ≥ 30 % or market purchases; the §6.4 pacing table is stale | Accept (it is the tier link of D-34); re-run pacing in playtests | units spec §6.4, W17 |
| R11 | Starting kit: SIMULATION says 400/250/150/150, units spec says pod cargo 600/350/200/200; 600 Metals exceeds the Hub T1 cap of 500 | SIMULATION's 400/250/150/150 (fits the cap) | SIMULATION §7.3, units spec, W01-09 |
| R12 | Temperate/Desert terrain mixes differ between SIMULATION §10 and units spec §4.5 | SIMULATION §10 wins; units spec cites it | W01-06, W05-17 |

**Balance numbers missing from the game specs** — **answered 2026-10-30: use the defaults below; the owner tunes them in playtests** (D-35: data tables + runtime `tune` overrides). `(H)` = on the hackathon path.

| # | Missing number or rule | Proposed default (agents use it until you answer) | Where |
|---|---|---|---|
| B1 | Terraforming Processor conversion rate (tiles/s); the spec only gives +0.15 %/s planet score | 0.5 tiles/s | W17 |
| B2 | View radii of Hub, Beacon T1 and other buildings for the shared view (`H`) | footprint radius + 4 tiles (Hub, Beacon T1: + 6) | W07-08 |
| B3 | When Hub T3 can be ordered (a dwell like S4's 8 min?) | 10 min dwell in S7, mirroring S4 | W19 |
| B4 | Do Recon, Tank and HQ weapons hit air? (§5.5 implies no) | No: only Autocannon and Laser Tower hit air | W19 |
| B5 | Unlock stages of the T2 rows not in the S5 list (Wind, Thermal, Hydro, Capacitor, Pylon, Laser, Hazard, Trade Hub, Nuclear T1/T2); is "Turret T2" the Autocannon only? | The stage of the T1 row + 1 (min S5); "Turret T2" = Autocannon only | W17 |
| B6 | T2/T3 special effects under battle v1 (Plasma Arc chain, Shield dome, Railgun AP, Depot T3 raid protection, Beacon T3 +15 % turret range, DCA T2/T3, Hazard Shield T2) | None in battle v1: plain stat bumps only | W17, W19 |
| B7 | Laser Tower T1: built in W07 at S3, but the stage table puts it at S7 (`H`) | S3, as W07 builds it; fix the stage table | W07-01 |
| B8 | Factory / DCA footprints: models 4×3 / 2×2, data 3×3 / 1×1 — refit models or change data? (`H`) | Data-table footprints (3×3 / 1×1); refit the models | W07-24 |
| B9 | Hunt-stance search radius (plan: 15 tiles) and Defend-area leash (`H`) | Hunt radius 15 tiles; Defend leash 8 tiles | W07 |
| B10 | Autocannon ammo (−0.2 M/s firing) and Laser +12 E/s spike: in battle v1? (`H`) | Neither in battle v1 | W07 |
| B11 | Fauna bite damage per hit and rate (spec gives DPS only) (`H`) | One bite per second; damage = spec DPS × 1 s | W07 |
| B12 | Wall Gate "in a wall line" rule (plan: ≥ 2 wall neighbours) (`H`) | ≥ 2 neighbouring wall tiles (hex) | W14 |
| B13 | Do storms raise the wind factor? No spec says so | No | W05-14 |

**Naming, routing and spec gaps**

| # | Question | Proposed default | Where |
|---|---|---|---|
| N1 | One domain or `game.` + root (D-24 one app vs CLIENT/ARCHITECTURE §4 two static sites)? | Two static sites on one app, as ARCHITECTURE §4 | W25-28 |
| N2 | Who adds production rewrites for `/me`, `/planets`, `/c/{id}` and `frontend/me.html` to `vite.config.ts`? | W25 (rewrites), W12 lead pre-step (`me.html`) | W12, W25 |
| N3 | Ports gain methods `NEAR.md` does not list (`keyStatus`, Deed `get`, Staking `listPools`/`withdraw`/`position`, Treasury `addMember`/`removeMember`/`get`, Escrow `get`) | Add them to NEAR.md's port table | W06, W20, W22 |
| N4 | Hackathon rule ids Q-002…Q-017 are cited but defined nowhere in the repo | Copy the hackathon rules into `HACKATHON_CUT.md` | W00-48, W25 |
| N6 | HUD technology | **Answered 2026-10-30 → D-36:** vanilla DOM + design-system CSS; ARCHITECTURE §12 and tech-stack-spec amended | W02-26, W01-29 |
| N7 | **Open question:** migrate the renderer to WebGPU + TSL (as the early `tech-stack-spec.md` proposed) at some point? | **Decided for now: keep the current WebGL2 + GLSL renderer in `frontend/render` unchanged.** No wave contains a renderer migration. Revisit only after the hackathon, if a measured need appears (draw calls, phone performance, WebGPU-only features) | `tech-stack-spec.md`, PRODUCT_WAVES §4 "One renderer" |
| N5 | `colony eliminate` dev command: owned by W09-31, but W11-29 registers it itself when W09 is off | Keep both (flag-safe fallback) | W09-31, W11-29 |

## Before W0 — decisions to grill (post-hackathon plan)

- [ ] Review and accept / change **D-01..D-15** in [`../spec/DECISIONS.md`](../spec/DECISIONS.md). The ones that reshape the most work:
  - **D-01** simulation is server-authoritative (overrides the browser Web Worker layout in `docs/spec/tech-stack-spec.md`).
  - **D-06** worker routing by path `ws.terraagent.com/w/{workerId}` vs. subdomain per worker.
  - **D-12** planet numbers: capacity `5`, admission window `24h`, lifetime `14d`, sealed seats never refill.
  - **D-13** planets tick at full rate even with nobody online (cost vs. simplicity).
  - **D-15** MVP gameplay scope. Its robot list is superseded by **D-16 (Accepted)**: MVP = stages S0–S7, 9 unit types.
- [x] Z.ai model decided (D-09 confirmed): `AI_MODEL=glm-5.3`, **general** endpoint `https://api.z.ai/api/paas/v4`. Still to do: check the id, price and rate limits in the Z.ai console.
- [ ] Choose a git host / repo name. Superseded by the hackathon item above (public GitHub repo before 11-01).

## Before W1 — local development

- [ ] Docker Desktop (or OrbStack) on every agent machine; ports `15434` (Postgres), `4001–4006`, `4101–4506`, `5173–5174` free. ~~`14222`/`18222` (NATS)~~: **obsolete under D-24** (no NATS).
- [ ] Node.js 22 LTS + npm 10.

## Before W2 — AI & NEAR (testnet)

- [ ] **Z.ai API key** for `glm-5.3` on the general endpoint → `ZAI_API_KEY` (ai-orchestrator only; secrets file, never committed). Set a console spend limit that matches `AI_DAILY_TOKEN_BUDGET=20M` (~$40/day).
- [ ] **Register now** (D-23): `terraagent.testnet` **and** `terraagent.near`, before the names are taken. Then, for **NEAR testnet**: create sub-account `colonies.terraagent.testnet`; put the full-access key into the near-gateway secret store; fund with testnet NEAR (faucet).
- [ ] Decide: is a wallet link required to keep a colony across devices, or is guest + "save progress" enough for launch? (D-10)
- [ ] **FastNEAR** API key (primary RPC, D-23) plus one fallback RPC endpoint (e.g. Lava) for testnet and mainnet.

## Before W4 — notifications, NEAR Intents, staking

- [ ] **Telegram bot** (D-17): create it with @BotFather and put the token in the core secrets as `TELEGRAM_BOT_TOKEN`; set the webhook domain to `api.terraagent.fun`.
- [ ] **Web Push VAPID keys** (D-17): generate a key pair; the public key goes to the game config and the private key to the core secrets.
- [ ] **NEAR Intents** (D-19, D-26): `intents.near` is **mainnet-only** (no testnet). Approve the mainnet cargo-token contract account `res.terraagent.near` (NEP-245) and fund the dev accounts above. ~~Testnet Intents/solver endpoint~~: obsolete, there is none.
- [ ] **Staking validator whitelist** (D-18): pick the validator pools players may stake to through their colony account (testnet first, then mainnet).

## Before W26 — the public hosts (D-37)

- [x] **Domain** `terraagent.fun` registered.
- [ ] **DNS, plain A records, not proxied.** Every name points at the server IP that will go in `DEPLOY_HOST`:
  - `terraagent.fun` (landing)
  - `pitchdeck.terraagent.fun`
  - `whitepaper.terraagent.fun`
  - `design.terraagent.fun` (the pages now at `/design/`)
  - `play.terraagent.fun`
  - `playground.terraagent.fun`
  - `devchain.terraagent.fun` (mock chain explorer)
  - `api.terraagent.fun`
- [ ] **SSH key.** Create a user on the server (the `DEPLOY_USER` in `.env`, default `deploy`) and copy your key to it (`ssh-copy-id` is fine; the deploy scripts will not do this). Docker and the compose plugin are installed. The user can run them.
- [ ] **`.env` on the operator machine:** `TA_DOMAIN=terraagent.fun`, `DEPLOY_HOST=<that IP>`, `DEPLOY_USER=<that user>`.
- [ ] **Laptop hosts file (optional):** install `infra/hosts/local.hosts` when W26 lands it, so a browser opens the same names against local nginx. Smoke tests do not need it.
- [ ] **Server** (D-23 size, D-37 front door): one VPS in a single region, **4 vCPU / 8 GB RAM**, ≥ 80 GB SSD.
- [ ] **TLS:** none for this phase. No Cloudflare zone, no origin certificate.
- [ ] **Backups:** local `pg_dump` only (W25-09). No R2 bucket until a later row. ~~JetStream snapshots~~: obsolete under D-24. ~~Cloudflare R2 in D-23~~: not this phase (D-37).
- [ ] Admin credentials policy for the ops API (TA-04.7): admin API key(s) or an allow-list of NEAR accounts.

## Before W5 — launch

- [ ] NEAR **mainnet**: `terraagent.near` is registered (above). Create `colonies.terraagent.near`, fund the relayer (budget per new colony account, see `NEAR.md`), and confirm that colony accounts become **claimable** by players at launch (D-18).
- [x] AI daily token budget: `AI_DAILY_TOKEN_BUDGET=20M` (~$40/day), raw prompt logs kept 14 days (D-09).
- [ ] Privacy policy and terms text for the landing (TA-12.2 ships placeholders).
- [x] Product analytics: first-party core endpoint + Postgres (opt-in).
- [ ] Sign off the launch checklist (TA-13.7).

## Open questions collected from the specs (grill list) — answered 2026-10-29

| # | Question | Answer | Decision |
|---|---|---|---|
| Q1 | Refill seats freed by early elimination? | Only within the first 2 h | D-12 (amended), TA-05.7 |
| Q2 | Chosen planet fills while queued? | Auto-place on the same planet type | D-12 |
| Q3 | Keep small planets recruiting past 24 h? | No: seal at 24 h | D-12 |
| Q4 | Parties / multiple regions? | **Parties needed for launch**; single region | D-22, D-23, TA-05.7 |
| Q5 | AI acts while away; spend caps? | AI yes, within away rules; **player-set away budget**; autoTrade shipped; AI raids opt-in | D-17, TA-08.6 |
| Q6 | Notifications; LLM away story? | **Web Push + Telegram**; LLM story behind a flag | D-17, TA-08.7, TA-11.10 |
| Q7 | Power bootstrap | Hub Founder Core +8 E/s | D-16 |
| Q8 | Old colony after the rocket | **Settled** colony (launch needs own territory 100 % Living); the player stakes their own NEAR through the colony account | D-18, TA-06.13, TA-10.7 |
| Q9 | Time lost on failover | **Fast-forward (catch-up) of downtime** | D-20, TA-07.9 |
| Q10 | Trade Hub T1 required for trades | Yes | D-16 |
| Q11 | WebGL vs WebGPU | WebGL2 + EffectComposer | D-22 |
| Q12 | Phones | **Full gameplay in landscape fullscreen** | D-22, TA-11.9 |
| Q13 | Analytics | First-party endpoint + Postgres | — |
| Q14 | Spectating | Not in v1 | D-22 |
| Q15 | Claim colony account; cross-planet trades | Claimable at launch; same planet only | D-18, D-19 |
| Q16 | Raw AI prompts logged | Raw, 14-day retention; rationale shown in the HUD | D-09 |
| Q17 | TLS, HSTS preload, host | Was Cloudflare and R2 (D-23). **Now HTTP on `terraagent.fun`, no Cloudflare, no R2, until a later wave (D-37).** Host size stays 4 vCPU / 8 GB | D-23, D-37 |
| Q18 | Display names; rejoin | Generated names + optional rename; no rejoin | — |
| — | Per-pylon max load | Enforced in MVP | D-21, TA-06.12 |
| — | NEAR Intents | **In MVP** (same-planet trades) | D-19, TA-10.6 |
| — | Landing hero | Live Three.js mini-diorama | D-22, TA-12.3 |
| — | Units, orders, ground, walls, truces, MVP S0–S7 | Accepted | D-16, TA-14 |

| — | Architecture after the relay idea | **Server sim kept, simplified: one NestJS app + Postgres**, no NATS / leases / replay | D-24 |
| — | Anti-cheat / anti-bot | **Removed** (keep zod validation, own-colony check, game rules, LLM caps) | D-25 |
| — | NEAR features; cargo cash-out | **F1–F8**, cargo **open (NEAR/USDC) in beta** | D-26 |
| — | Hackathon team & scope | **Solo + AI agents**, 14-day demo cut | D-27 |

**Obsolete owner items under D-24:** NATS ports, JetStream snapshot backups, worker routing / per-worker DNS, NATS credentials. Anything mentioning worker drain or leases in the W3–W5 lists applies only to the post-hackathon "Future" architecture.

Still open for the owner: the social-login provider (F5), the Grafana exposure and alert destination (TA-13.2), and whether a wallet link is required across devices (D-10).
