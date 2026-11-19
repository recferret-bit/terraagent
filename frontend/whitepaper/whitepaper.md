# TerraAgent — Whitepaper

> Outward-facing specification updated 2026-11-18. Matches [`README.md`](https://github.com/recferret-bit/terraagent/blob/main/README.md), `@terra/sim` deterministic rules, and the live NEAR Testnet deployments + 7-crate Rust workspace. Fee rates, staking splits, and guild parameters are configurable protocol defaults calibrated in the 7-day economy simulator (`/dev/economy-sim/`). *Note: this document describes game and protocol mechanics and makes no promise regarding any token value.*

## 1. Thesis: the economy is the gameplay

Traditional strategy games stop when you close the browser tab and patch balance on spreadsheets. Early blockchain games inverted the problem: tokens came first and gameplay came second. TerraAgent builds a real-time colony RTS where supply, terrain scarcity, trade routes, diplomacy, and autonomous AI directors form one continuous economy across NEAR Protocol and hardware-attested NEAR.AI.

## 2. Web3 ownership & first-class NEAR accounts

- **Human Pilots:** Drop in immediately via FastAuth, OAuth, or 10 NEAR wallets (Meteor, MyNearWallet, Intear, OKX, NEAR Mobile, Bitte AI, HOT, HERE, Nightly, Sender) to provision `{pilot}.pilots.terraagent.testnet`. Authenticated `NEP-366` meta-transactions (`POST /v1/near/relay`) share a global daily gas budget, while atomic `claimAccount` rotates `[AddKey, DeleteKey]` to full self-custody and optionally seals a revocable scoped trading session key so 1-click orderbook trading (or direct `walletSignature` signing) works without surrendering custody.
- **Colony Sub-Accounts & Social Identity:** Isolated sub-accounts hold `NEP-245` orbital cargo (`mt_batch_transfer`, `mt_transfer_call`, holder `mt_withdraw`, NEP-145 storage bounds), lock native payable NEAR and cargo escrows (`open_near_escrow`, `claim_expired_refund`), vote in Planet Council DAOs (with SputnikDAO v2 JSON export), and share soulbound `NEP-171` Colony Deeds (`prune_history`, NEP-181 pagination) directly to **NEAR Social**.
- **AI Directors, Hosted MCP & Shade MPC:** Autonomous Directors use HMAC-keyed deterministic Ed25519 keys (`deriveDirectorPublicKey`) bound via finite-gas on-chain `AddKey(FunctionCall)`/`DeleteKey`. External agents trade through the **Hosted MCP Server** (`POST /v1/mcp`, `GET /v1/mcp/agent-market.json`, `POST /v1/trade/agent/rfq`) alongside decentralized **Shade Agents** + **Chain Signatures MPC (`v1.signer`)**.
- **Guild Traders & Protocol Treasury:** NPC freighters (`kestrel`, `vanguard`) quote VWAP-anchored spreads paired with a live **1Click Cross-Chain Deposit/Withdraw Ramp** on `/trade.html`, while `protocol.terraagent.testnet` collects organic protocol shares to fund gasless onboarding and Managed NEAR.AI.

What autonomous agents **cannot** do without a human: bypass runtime governance (kill switches, paused policies, revoked director keys, live exposure limits, or VWAP price bands), inject instructions across isolated staker/player `<untrusted_player_label>` fences, exceed ACID spend caps, break an active peace truce or cancel a war, lock human NEAR in bonds, dismantle buildings, claim ownership keys, or stake validator NEAR (`403 AI_STAKING_FORBIDDEN`).

## 3. Player income, lossless staking, 4-way settlement & TerraAgent Protocol

- **Cargo Exports (`100%` to Seller):** Mine surface commodities and wrap them 1-to-1 into `18`-decimal `NEP-245` cargo tokens on `res.terraagent.testnet` across all `10` T1–T3 resources — **Iron** (`metals.t1`), **Light Alloys** (`metals.t2`), **Titanium** (`metals.t3`), **Silica** (`minerals.t1`), **Rare Earths** (`minerals.t2`), **Exotic Crystal** (`minerals.t3`), **Water** (`bio.water`), **Biomass** (`bio.biomass`), **Petroleum** (`bio.t2`), and **Gene-stock** (`bio.t3`) — then sell for USDC, NEAR, or barter cargo on `/trade.html`.
- **Trade Hub Stall Royalties (`0–1.00%`):** Every built Trade Hub acts as a commercial storefront earning `0–100 bp` maker royalties on filled orders.
- **Scoped Trading Bots & Bounties:** Automated `ta_bot_...` bots arbitrage orbital spreads within ACID daily limits, while mercenary defense bounties and breached peace/war bonds pay `90%` directly to victims or defenders.
- **4-Way Atomic Settlement:** Every trade clears atomically via counter-signed `NEP-413` `token_diff` intents across four recipients on top of notional: Seller Principal (`100%`), Stall Owner (`0–1.00%`), Planet Council DAO (`20%` of platform fee = `0.20%` standard / `0.10%` staker), and `protocol.terraagent.testnet` (`80%` of platform fee = `0.80%` standard / `0.40%` staker). On a `$100.00 USDC` fill with a `0.50%` stall fee, a standard buyer pays `$101.50` (`$101.00` for stakers): `$100.00` to Seller, `$0.50` to Stall Owner, `$0.20` (`$0.10`) to Planet DAO, and `$0.80` (`$0.40`) to Protocol.
- **Day-1 Lossless Staking:** Stake NEAR from Day 1 on `staking.terraagent.testnet` (`9.0%` gross pool APY, `2` game-day unbonding). Pilots keep `100%` principal plus `80%` of yield (`7.20%` net APY); `20%` (`1.80%` APY) funds `TerraAgent Protocol`. A `50 NEAR` Day-1 stake earns `+3.60 NEAR/yr` for the pilot and routes `+0.90 NEAR/yr` to Protocol — unlocking Managed NEAR.AI Autopilot and a `50%` platform fee cut (`1.00%` down to `0.50%`) at `>= 10 NEAR` with **zero** combat or harvesting buffs.
- **Bonded Diplomacy & 6-Hour War Escrows:** Bonded truces (`2h–72h`) and `6h` War Bonds (granting `2x` Raider carry capacity `40 -> 80`) lock collateral on `bounty.terraagent.testnet`. Peaceful truce completion or meeting war objectives (`>= 1` razed structure or `>= 200` siphoned resources) refunds `100%`; early betrayal or failed sieges slash `90%` (`18.0 NEAR` on a `20 NEAR` bond) to the counterparty and `10%` (`2.0 NEAR`) to Protocol.
- **Why `TerraAgent Protocol` Scales Net-Positive (Zero Token Printing):** Three organic inflows (`0.80%/0.40%` trade fee share, `1.80%` validator yield slice, and `10%` bond slashes) fund the two real Web3/AI operating costs: `relayer.terraagent.testnet` gasless `NEP-366` meta-transactions (`~0.0003 NEAR/tx` within a `5 NEAR/day` cap and `<= 0.05 NEAR` attached deposit limit, plus `0.02 NEAR` cold-root pilot provisioning — at an illustrative `~$4/NEAR`, one `$100 USDC` fill's `+$0.80 ≈ 0.20 NEAR` funds `~650` player meta-txs) and batched `NEAR AI Cloud` TEE turns (`1` `z-ai/glm-5.3-flash` RPC every `180 s` packing up to `5` colonies into one request with a `120 s` state-digest burst cooldown ≈ `$0.03–$0.05/planet/day`). Just `~$7/day` of planet trade volume (`$7 × 0.80% = $0.056/day`) or `200 NEAR` of planet staked TVL (`4 × 50 NEAR` pilots generating `+3.60 NEAR/yr ≈ $14.40/yr` or `~$0.04/day` at `~$4/NEAR`) covers an entire persistent 24/7 planet; all rates are live-inspectable at [`GET /v1/near/protocol`](/v1/near/protocol).

## 4. Verifiable NEAR.AI commanders, Agent Commerce, 25-Agent Swarms & Guild pricing

- **Orbital Guild VWAP Pricing:** Scheduled NPC freighters (`kestrel`, `vanguard`) quote every T1 pair from trailing `24h` organic VWAP (min `3` eligible fills) via `mid = ref * clamp((T + 10) / (I + 10), 0.50, 2.00)^0.5`, widening half-spreads from `2%` (`4%` full spread) to `15%` on the thin inventory side while exporting `10%` of surplus off-planet on departure.
- **Governed TEE Commanders, In-Browser Proofs & Encrypted BYOK:** Rival AI colonies and Managed Staker Autopilot run batched `z-ai/glm-5.3-flash` turns on **NEAR AI Cloud** (`cloud-api.near.ai/v1`) with strict staker prompt isolation and `<untrusted_player_label>` prompt-injection filtering. Runtime governance validates live order exposure, canonical price bands, kill switches, and active director keys (`AddKey`/`DeleteKey`), then verifies `/v1/signature/{chat_id}` (`SHA-256` `model:request:response` `secp256k1` / `Ed25519`), persists `DirectorTeeAttestation` records (`GET /v1/near/ai/attestations`), and lets pilots re-verify enclave proofs directly in-browser via `secp256k1` EIP-191 & WebCrypto `Ed25519` (`TEE ✓` modal & live `/me.html` enclave probe). Stakers (`>= 10 NEAR`) also see an active `MANAGED STAKER AI ACTIVE` banner alongside `AES-256-GCM` BYOK vaults (`GLM-5.3`, `GLM-5.3 Flash`, `DeepSeek V3.2`, `DeepSeek V4.1 Flash`, `Qwen 3.8 27B`, `GPT-5 Mini`, `Claude Sonnet 4.6`, or custom model IDs).
- **Hosted MCP Server, Agent RFQ & Persistent Nonces:** External agents discover pair specs at `GET /v1/mcp/agent-market.json`, execute JSON-RPC 2.0 tools (`list_planets`, `list_pairs`, `get_orderbook`, `quote_swap`, `get_balances`, `place_order`, `cancel_order`, `negotiate_rfq`) over `POST /v1/mcp` or `POST /v1/trade/agent/rfq`, and settle `NEP-413` `token_diff` swaps protected by persistent `nep413_used_nonce` replay tables plus a standalone **`verifier`** Rust contract crate (`env::ed25519_verify`).
- **Contractor Agents, 25-Account Swarms & Shade MPC:** Scoped contractors execute 1-round negotiation (`negotiateAgentQuote`) and verifiable `AgentTaskReceipt` proofs, 25-account swarms clear zero-LLM uniform auctions (`/dev/economy-sim/`), and decentralized **Shade Agents** (`npm run shade:worker`) sign cross-chain actions via **NEAR Chain Signatures MPC (`v1.signer`)**.

## 5. Core loop, cadence & trust architecture

You land one Hero bot, build a Command Hub, expand across Desert, Ocean, and Temperate worlds, terraform hexes into Living ground to unlock T2 (30%) and T3 (70%) resources, and race neighbors to the S10 Ascension Rocket.

| Cadence | Player Decision | Economic Consequence |
|---|---|---|
| Every 30 s | Place extractors, power grids, or terraform brushes | Storage fills fast: spend, export cargo, or stall production |
| Every 5 min | Survive night drops, raids, or Guild freighter docks | Unbuffered dusk sheds power; docking re-prices markets |
| Every session | Climb stages S0–S10 and tune away budgets | Higher tiers shift supply chains and overnight AI trades |

| Trust Layer | Authoritative State | Responsibility |
|---|---|---|
| NEAR Protocol + NEAR.AI | Pilot/colony accounts, scoped session & director keys, `NEP-245` cargo, `NEP-171` deeds, native escrows, staking, DAO, `verifier` & browser-verifiable TEE proofs | Custody, finality, and verifiable AI |
| Simulation Server (`@terra/sim`) | Deterministic 5 Hz hex state, power grids, combat, governed AI checks, MCP server & agent spend caps | Game physics, prompt isolation & rate protection |
| WebGL2 Client (`Three.js`) | 60 FPS diorama rendering, 10-wallet selector, in-browser `TEE ✓` verifier & input dispatch | Responsive UI (zero authority) |

## 6. Live NEAR Testnet deployments & workspace contracts

| Account | Standard & Role | Testnet Proof |
|---|---|---|
| `res.terraagent.testnet` | `NEP-245` Orbital Cargo (`mt_batch_transfer`, `mt_transfer_call`, `mt_withdraw`, NEP-145 bounds) | [5reiQL5X…](https://testnet.nearblocks.io/txns/5reiQL5XddxLS9hDDmKrh1Nn4N8f5Ui9KjtqySvGejok) |
| `deed.terraagent.testnet` | `NEP-171` Soulbound Deeds (`prune_history`, NEP-181 pagination, NEAR Social shares) | [E1AGHyMm…](https://testnet.nearblocks.io/txns/E1AGHyMmzCGdsRqvoMVjqWqVQGGkuRu3djQzuRj3wRGK) |
| `bounty.terraagent.testnet` | Mercenary Bounties, Truces & War Escrows (`open_near_escrow`, `mt_on_transfer`, `claim_expired_refund`) | [21F1c5Td…](https://testnet.nearblocks.io/txns/21F1c5TdGtgcAhoTMPRMkHCYvQ15USqo4fpxBrXU8UAB) |
| `staking.terraagent.testnet` | Day-1 Lossless Vault (`stake_payable`, LST `ft_on_transfer`, `GET /v1/near/staking/wallet-tx`) | [5UvHFrKU…](https://testnet.nearblocks.io/txns/5UvHFrKUocqf5JewptneZqGeXgXkJQZaeVMPfHTrusX2) |
| `dao.terraagent.testnet` | Planet Council Treasury Voting + SputnikDAO v2 JSON export | [DmsGYQ7V…](https://testnet.nearblocks.io/txns/DmsGYQ7VBajz1rRC5FKxNarnnddhs5CzeVgfJc6mqx5U) |
| `pilots.terraagent.testnet` | Cold-Root Pilot Sub-Account Factory (`create_pilot_account`) | [cSTqNFu5…](https://testnet.nearblocks.io/txns/cSTqNFu5aQKb9MiJwantuhxj4Hwn3T2D4WbhCHJAr2h) |
| `verifier` (`NEAR_CONTRACT_VERIFIER`, workspace crate) | On-Chain NEP-413 `token_diff` Borsh/Ed25519 verifier, key-binding & replay registry (`102` workspace Rust tests) | Pre-deploy WASM built |

### Core Protocol & Gas-Paying Operator Accounts

| Account | Role | Gas & Security Explanation | Testnet Proof |
|---|---|---|---|
| [`terraagent.testnet`](https://testnet.nearblocks.io/address/terraagent.testnet) | **Cold Root & Governance Owner** | Owns all deployed contracts and holds reserve NEAR for `npm run near:health --apply` top-ups; hot runtime stays isolated without root keys when `NEAR_USE_PILOTS_FACTORY=true`. | [3qmHWbgs…](https://testnet.nearblocks.io/txns/3qmHWbgsfNoykfDeuLsyGVw36kaUmGN5uUiJqrHBgRLH) |
| [`protocol.terraagent.testnet`](https://testnet.nearblocks.io/address/protocol.terraagent.testnet) | **Protocol Treasury (`NEAR_PROTOCOL_ACCOUNT`)** | Receives 80% of platform trade fees, 20% of validator staking yield, and 10% of breached bond slashes to fund relayer gas and Managed NEAR.AI. | [9q3km4Ti…](https://testnet.nearblocks.io/txns/9q3km4TiFVGnY6HMZUaZdXWmtuMTJ1cy3hvGXyM9ArXY) |
| [`relayer.terraagent.testnet`](https://testnet.nearblocks.io/address/relayer.terraagent.testnet) | **NEP-366 Gas Relayer & Pilot Operator (`NEAR_RELAYER_ACCOUNT`)** | Pays gas for allowlisted `SignedDelegate` meta-transactions within a shared `5 NEAR/day` daily cap (`<= 0.05 NEAR` attached deposit) and sponsors `0.02 NEAR` pilot creation on `pilots`. | [BWsCAjsC…](https://testnet.nearblocks.io/txns/BWsCAjsCUDrQsZbd85EHaLZZrFVWrvAHJseXoPpGFyY1) |
| [`minter.terraagent.testnet`](https://testnet.nearblocks.io/address/minter.terraagent.testnet) | **Authorized Contract Gas Signer (`NEAR_MINTER_ACCOUNT`)** | Pays gas and signs serialized FIFO operator calls across `res`, `deed`, `bounty`, `staking`, and `dao` without holding root governance keys. | [9AyXKPYV…](https://testnet.nearblocks.io/txns/9AyXKPYVSLCDaZA59aZWihYmCr6PaqahAmcuH36uMok6) |

| Capability | Live NEAR Testnet | Offline Local Sandbox |
|---|---|---|
| Accounts & Relayer | `pilots` factory + authenticated `NEP-366` relayer (shared daily budget) + 10 wallets + scoped session keys | Ephemeral local keypair & instant mock receipts |
| Cargo & 4-Way Swaps | `res` `NEP-245` mint/burn/transfer_call + `NEP-413` persistent nonces + `1Click` cross-chain ramp + Hosted MCP | Local Postgres ledger & deterministic matcher |
| Deeds, Bonds & Social | `deed` + NEAR Social share & `bounty` native/cargo 90/10 escrows + expired self-refund | Mock chain tables with identical state transitions |
| Staking, DAO & MPC | `staking` (80/20 split, human-only, direct wallet tx), `dao` + SputnikDAO v2 export & Shade `v1.signer` MPC | Simulated validator epochs & local council tally |
| Verifiable AI Commander | Governed `z-ai/glm-5.3-flash` TEE + persisted attestations + browser `secp256k1` / WebCrypto `Ed25519` `TEE ✓` verifier | Deterministic mock planner for offline testing |

## 7. Known risks & design trade-offs

- Automation is first-class in beta under explicit spend and rate caps rather than identity gates; resource caps pace emission without promising price floors.
- Daily agent spend allowances, staker fee tiers, and war objectives are enforced by `@terra/sim` + PostgreSQL ACID locks; custody, deeds, staking principal, and escrow settlements live on NEAR.
- Repository history starts 2026-10-29 within the hackathon window, with starter terrain/visual scaffolding disclosed in `README.md`.
