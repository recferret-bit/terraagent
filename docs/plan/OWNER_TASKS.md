# Owner tasks — things agents cannot do

> Checklist of accounts, keys, infrastructure and decisions only the owner can provide. Each item names the wave that needs it. Agents mark an item `[!] Blocked` in their task when it is missing and continue with mocks.

## Before W0 — decisions to grill

- [ ] Review and accept / change **D-01..D-15** in [`../spec/DECISIONS.md`](../spec/DECISIONS.md). The ones that reshape the most work:
  - **D-01** simulation is server-authoritative (overrides the browser Web Worker layout in `tech-stack-spec.md`).
  - **D-06** worker routing by path `ws.terraagent.com/w/{workerId}` vs. subdomain per worker.
  - **D-12** planet numbers: capacity `5`, admission window `24h`, lifetime `14d`, sealed seats never refill.
  - **D-13** planets tick at full rate even with nobody online (cost vs. simplicity).
  - **D-15** MVP gameplay scope.
- [ ] Confirm the Z.ai model: the brief says "z.ai 5.3"; the plan uses `AI_MODEL=glm-5.3` at `https://api.z.ai/api/paas/v4` (third-party listings; confirm in the Z.ai console, including general vs. coding-plan endpoint and price).
- [ ] Choose a git host / repo name. `TerraAgent/` is not a git repository yet; W0 (TA-01.1) runs `git init`.

## Before W1 — local development

- [ ] Docker Desktop (or OrbStack) on every agent machine; ports `15434` (Postgres), `14222`/`18222` (NATS), `4001–4006`, `4101–4506`, `5173–5174` free.
- [ ] Node.js 22 LTS + npm 10.

## Before W2 — AI & NEAR (testnet)

- [ ] **Z.ai API key** → `ZAI_API_KEY` (ai-orchestrator only; secrets file, never committed). Set a monthly spend limit in the console.
- [ ] **NEAR testnet**: create `terraagent.testnet` and sub-account `colonies.terraagent.testnet`; put the full-access key into the near-gateway secret store; fund with testnet NEAR (faucet).
- [ ] Decide: is a wallet link required to keep a colony across devices, or is guest + "save progress" enough for launch? (D-10)

## Before W3 — production infrastructure

- [ ] **Domain** `terraagent.com` registered; DNS records:
  - `terraagent.com` A/AAAA → server
  - `www.terraagent.com` CNAME → `terraagent.com`
  - `game.terraagent.com` A/AAAA → server
  - `api.terraagent.com` A/AAAA → server
  - `ws.terraagent.com` A/AAAA → server
- [ ] **TLS choice:** Cloudflare proxied (WebSockets on, origin certificate on nginx, SSL mode "Full (strict)") **or** Let's Encrypt via certbot. If Cloudflare: create the origin certificate and give it to the deploy secrets.
- [ ] **Server:** one VPS for launch (suggested ≥ 8 vCPU / 16 GB RAM / 160 GB SSD; final size from the W5 load test), SSH access for deploy, Docker + compose installed.
- [ ] **Backups:** an S3-compatible bucket + credentials for nightly `pg_dump` and JetStream snapshots.
- [ ] Admin credentials policy for the ops API (TA-04.7): admin API key(s) or an allow-list of NEAR accounts.

## Before W5 — launch

- [ ] NEAR **mainnet** decision: stay on testnet for launch or create `terraagent.near` + `colonies.terraagent.near` and fund the relayer (budget per new colony account, see `NEAR.md`).
- [ ] AI daily token budget for production (`AI_DAILY_TOKEN_BUDGET`) — see the cost model in `AI_ORCHESTRATOR.md`.
- [ ] Privacy policy and terms text for the landing (TA-12.2 ships placeholders).
- [ ] Product analytics provider (or none): events are opt-in; see `CLIENT.md`.
- [ ] Sign off the launch checklist (TA-13.7).

## Open questions collected from the specs (grill list)

Each spec ends with its own "Open questions" section; the ones that change scope or cost:

| # | Question | Where | Current default in the plan |
|---|---|---|---|
| Q1 | Refill seats freed by early elimination on a still-recruiting planet? | [MATCHMAKING](../spec/MATCHMAKING.md) | No — `seatsTaken` is monotonic |
| Q2 | Chosen planet fills while queued: auto-place elsewhere or back to picker? | MATCHMAKING | Auto-place on another planet of the same type |
| Q3 | Keep a small planet (1–2 colonies) recruiting past 24 h? | MATCHMAKING / D-12 | No — sealed at 24 h |
| Q4 | Parties/friends, multiple regions? | MATCHMAKING | Out of MVP |
| Q5 | May the AI act while the player is away; spend caps 40 % per directive / 60 % per away session? | [CONTINUITY](../spec/CONTINUITY.md), [AI_ORCHESTRATOR](../spec/AI_ORCHESTRATOR.md) | Yes, capped; no raids started while away |
| Q6 | Push/email notifications while away; LLM-written away digest? | CONTINUITY | Out of scope; template digest |
| Q7 | New colony power bootstrap: Hub "Founder Core" +8 E/s, or prebuilt solar + capacitor? | [SIMULATION](../spec/SIMULATION.md) §14 | Open — needed before W2 |
| Q8 | Old colony after rocket launch: ruins or AI-run? | SIMULATION | Open — needed before W4 |
| Q9 | Accept up to ~10 s of game time lost per failover (no fast-forward)? | SIMULATION / CONTINUITY | Yes |
| Q10 | Trade Hub T1 and Rocket Silo T2 added beyond the D-15 list — OK? | SIMULATION §7 | Added |
| Q11 | WebGL + EffectComposer first, or WebGPU/TSL from day one (as `tech-stack-spec.md` says)? | [CLIENT](../spec/CLIENT.md) §14 | WebGL first |
| Q12 | Phones: 2D colony-status view or desktop-only? | CLIENT | Open |
| Q13 | Analytics: own `/v1/analytics/events` or Plausible/Umami? | CLIENT | Own endpoint, opt-in |
| Q14 | Spectating planets you are not on? | CLIENT / PROTOCOL | Open (not in MVP scope) |
| Q15 | Players can claim their colony NEAR account? Trades across planets? | [NEAR](../spec/NEAR.md) | Open |
| Q16 | Raw AI prompts logged? | AI_ORCHESTRATOR | Hashes only |
| Q17 | TLS (Cloudflare vs certbot), HSTS preload, Grafana exposure (SSH tunnel vs `ops.terraagent.com`), alert destination? | [DEPLOYMENT](../spec/DEPLOYMENT.md), TA-13.2 | Open |
| Q18 | Display names: free text or generated? Rejoin a planet after elimination? | [DATA_MODEL](../spec/DATA_MODEL.md) | Free text ≤ 32 chars + filter; no rejoin |
