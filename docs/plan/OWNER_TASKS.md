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

- [ ] **Public GitHub repo + LICENSE.** `TerraAgent/` is not a git repository yet. Create a public repo (judges cannot open private ones) and add a LICENSE file. Commit the current state **before 11-01** so the pre-window baseline (`src/` prototype, docs) is clearly separated from hackathon work.
- [ ] **Mainnet dev accounts + a small NEAR balance** for NEAR Intents testing (`intents.near` has no testnet): e.g. `dev-a.terraagent.near` and `dev-b.terraagent.near`, plus the server port account for minting (`res.terraagent.near` deployer). A few NEAR is enough; mainnet costs are not reimbursed.
- [ ] **1Click partner JWT** (optional): register at `partners.near-intents.org` to avoid the 0.2 % fee without a JWT.
- [ ] **Pick a social-login provider** for F5 (HOT is a listed hackathon partner; check the others for NEAR named-account support). Fallback: guest + server-created custodial sub-accounts.
- [ ] **Prize payout wallet:** a **mainnet** NEAR account owned by you (the submission form asks for it).
- [ ] **X account** for the required demo post ("built at NEAR HACKATHON" + video).
- [ ] **4 vCPU / 8 GB host + Cloudflare** ready by **11-13** for the hosted demo (a local-only demo is allowed as a fallback).

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

- [ ] **Telegram bot** (D-17): create it with @BotFather and put the token in the core secrets as `TELEGRAM_BOT_TOKEN`; set the webhook domain to `api.terraagent.com`.
- [ ] **Web Push VAPID keys** (D-17): generate a key pair; the public key goes to the game config and the private key to the core secrets.
- [ ] **NEAR Intents** (D-19, D-26): `intents.near` is **mainnet-only** (no testnet). Approve the mainnet cargo-token contract account `res.terraagent.near` (NEP-245) and fund the dev accounts above. ~~Testnet Intents/solver endpoint~~: obsolete, there is none.
- [ ] **Staking validator whitelist** (D-18): pick the validator pools players may stake to through their colony account (testnet first, then mainnet).

## Before W3 — production infrastructure

- [ ] **Domain** `terraagent.com` registered; DNS records:
  - `terraagent.com` A/AAAA → server
  - `www.terraagent.com` CNAME → `terraagent.com`
  - `game.terraagent.com` A/AAAA → server
  - `api.terraagent.com` A/AAAA → server
  - `ws.terraagent.com` A/AAAA → server
- [x] **TLS choice: Cloudflare proxied** (D-23).
- [ ] **Cloudflare zone** for `terraagent.com`, proxied, with WebSockets on and SSL mode "Full (strict)"; create the origin certificate for the deploy secrets. **No HSTS preload** at launch.
- [ ] **Server** (D-23): one VPS in a single region, **4 vCPU / 8 GB RAM** (the owner's choice; raise it if the W5 load test says so), ≥ 80 GB SSD, SSH access for deploy, Docker + compose installed.
- [ ] **Backups** (D-23): a **Cloudflare R2** bucket + access key for nightly `pg_dump` (planet snapshots live in Postgres). ~~JetStream snapshots~~: **obsolete under D-24**.
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
| Q17 | TLS, HSTS preload, host | Cloudflare; no preload; 4 vCPU / 8 GB; R2 backups | D-23 |
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
