# Environment variables

Defaults the app uses when a variable is unset. The running catalog, including dev-console commands, is [`DEV_TOOLS.md`](./DEV_TOOLS.md). Later waves add their own rows here. Do not put this file in the repository root.

| Variable | Default | What it does |
|---|---|---|
| `NEAR_ADAPTER_IDENTITY` | `mock` | `IdentityPort`. `testnet` or `mainnet` selects the real adapter (W23). Anything else is the mock. |
| `NEAR_ADAPTER_RELAYER` | `mock` | `RelayerPort`. Same selection rule as identity. |
| `NEAR_KEK` | dev 32-byte key | Base64 of 32 bytes. Seals ed25519 seeds (AES-256-GCM). Production refuses a missing key or the dev key. |
| `MOCK_OAUTH_SECRET` | `terra-dev-mock-oauth-secret` | HMAC secret for `/dev/mock-oauth` tokens. Unset or empty uses the default. |
