# Landing brief — copy per section (2026-10-31)

> Copy for `frontend/landing.html`, section by section as it exists today (`hero`, `drop`, `colony`, `economy`, `planets`, `director`, `chain`, `roadmap`, `market`, `faq`, `final`). Implementing it is W24 (H+) or one small H issue (text swaps only; no new components). Marketing is allowed here, not in the README.

**Stale against the decisions:** the `economy` headline says "Five resources"; D-34 made it three families with three tiers. The `planets` section promises three worlds; the hackathon demo opens Temperate only (say "first world open"). The roadmap section must match the mock/real table.

| Section | Headline | Body (≤ 60 words) | Visual |
|---|---|---|---|
| `hero` | **Drop one robot. Get a colony that never sleeps.** | A strategy game where the colony mines, builds, defends, terraforms and trades around the clock, on NEAR, without ever showing you a wallet. Built at NEAR HACKATHON. | the existing orbit hero; CTA "Land now" (Google login) and "Send your agent" (MCP docs) |
| `drop` | **You give orders once. The colony works around the clock.** | Queue a building, a drone or a terraform brush; the lanes run while you are away. Set an away budget and the director trades for you within it. | GIF 1 descent → Hub |
| `colony` | **Nobody is playing this. It runs anyway.** | Five colonies share a planet for fourteen days. Night comes every twenty minutes; terraforming is shed first, defenses last. | GIF 2 first night |
| `economy` | **Three families. Three tiers. Every building draws power.** | Iron, silica and water from landing; alloys, rare earths and petroleum only on Living ground. Storage fills in minutes, so you spend, export, or lose it. | resource viewer: Metals / Minerals / Bio / Energy tabs (W24-36) |
| `planets` | **New players land on new worlds. The first one is open.** | Granite Hollow, temperate, is live. Kharon Dunes and Thalassa Verde follow. Each planet has its own market, treasury and Guild schedule. | the three planet cards, two marked "soon" |
| `director` | **Rules for routine. An agent for the rest.** | The director is an agent with a capped key: it buys the water you lack and sells the iron you cannot store, and it can never spend more than you allowed. Any AI agent can play the same way through the Colony API. | diagram 3 (what the key can and cannot do) |
| `chain` | **You play a colony, not a wallet.** | Google login gives you a real NEAR account. Cargo is a multi-token. Deals settle as NEAR Intents. The Guild traders have wallets of their own. You see cargo and contracts; the chain stays out of sight. | explorer screenshots (D6, D9, D11) |
| `market` | **From first click to your own market.** | Open a Trade Hub, set a 0–3 % fee, and every trade through your stall pays you. Guild prices follow one readable rule, and every offer shows its reason. | GIF 4 Guild docks + tooltip; price chart |
| `roadmap` | **Flight plan.** | What is real on Nov 14 and what is mocked, in the same words as the README; then desert and ocean worlds, the air layer, walls, PvP, mercenaries, staking on Settled deeds. | the mock/real table |
| `faq` | **Questions from orbit** | Is there a token? Cargo tokens are game items, mintable only from simulated stock; they carry no promise of value. Do I need a wallet? No. Can my agent play? Yes, through the MCP; it gets an allowance and a receipt per trade. What is pre-hackathon? The 3D prototype; everything else was built in the window. | — |
| `final` | **Your founder is waiting in orbit.** | Land with Google, or send your agent. | CTA pair |

Also add: a small "Built at NEAR HACKATHON" badge in the nav, the repo link, and a footer line with the hosted sector status (planets open, colonies, trades settled today) fed by the live-stats section that already exists.
