/**
 * Deploy spec of `verifier.<root>` (`backend/near-contracts/verifier`, the `intents.near`-compatible verifier:
 * `register_account_key`, `has_public_key`, `balance_of`, `execute_intents`, `strict_balances`).
 *
 * Env: `NEAR_CONTRACT_VERIFIER` (account id), `NEAR_VERIFIER_WASM` (wasm path override),
 * `NEAR_VERIFIER_WASM_SHA256` (hex pin; deploy fails on mismatch), `NEAR_VERIFIER_STRICT_BALANCES` (default `true`).
 */
export function verifierSpec({ rootAccount, minterAccount, wasmDir }) {
  const strictRaw = (process.env.NEAR_VERIFIER_STRICT_BALANCES ?? 'true').trim().toLowerCase();
  return {
    key: 'verifier',
    accountId: process.env.NEAR_CONTRACT_VERIFIER?.trim() || `verifier.${rootAccount}`,
    initialNear: '2.60',
    wasmPath: process.env.NEAR_VERIFIER_WASM?.trim() || `${wasmDir}/terra_verifier_contract.wasm`,
    wasmEnv: 'NEAR_VERIFIER_WASM',
    expectedSha256: process.env.NEAR_VERIFIER_WASM_SHA256?.trim() || undefined,
    probeMethod: 'account_key_count',
    probeArgs: { account_id: '__init_probe__' },
    initArgs: { owner_id: rootAccount, operator_id: minterAccount, strict_balances: strictRaw !== 'false' && strictRaw !== '0' },
  };
}
