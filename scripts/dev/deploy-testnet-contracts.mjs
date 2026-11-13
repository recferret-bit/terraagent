#!/usr/bin/env node
/**
 * Deploys and initializes TerraAgent's Staking Vault and Treasury DAO contracts on NEAR Testnet.
 * Reads keys from `~/.near-credentials/testnet` (never logs private keys).
 *
 * Usage: node scripts/dev/deploy-testnet-contracts.mjs [--redeploy]
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, PublicKey, nearToYocto, teraToGas } from 'near-api-js';

const ROOT_ACCOUNT = 'terraagent.testnet';
const RELAYER_ACCOUNT = 'relayer.terraagent.testnet';
const OPERATOR_ACCOUNT = 'minter.terraagent.testnet';
const RPC_URL = process.env.NEAR_RPC_PRIMARY || 'https://test.rpc.fastnear.com';
const CREDS_DIR = process.env.NEAR_CREDENTIALS_DIR || path.join(os.homedir(), '.near-credentials', 'testnet');
const REDEPLOY = process.argv.includes('--redeploy');

const SPECS = [
  {
    accountId: `staking.${ROOT_ACCOUNT}`,
    initialNear: '2.45',
    wasmPath: 'backend/near-contracts/target/wasm32-unknown-unknown/release/terra_staking_contract.wasm',
  },
  {
    accountId: `dao.${ROOT_ACCOUNT}`,
    initialNear: '2.65',
    wasmPath: 'backend/near-contracts/target/wasm32-unknown-unknown/release/terra_dao_contract.wasm',
  },
];

async function readCredential(accountId) {
  const file = path.join(CREDS_DIR, `${accountId}.json`);
  const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
  return { accountId: parsed.account_id || accountId, publicKey: parsed.public_key, privateKey: parsed.private_key };
}

async function ensureSubCredential(accountId) {
  const file = path.join(CREDS_DIR, `${accountId}.json`);
  try {
    return await readCredential(accountId);
  } catch {
    const kp = KeyPair.fromRandom('ed25519');
    const rec = { account_id: accountId, public_key: kp.getPublicKey().toString(), private_key: kp.toString() };
    await fs.mkdir(CREDS_DIR, { recursive: true });
    await fs.writeFile(file, JSON.stringify(rec, null, 2), { mode: 0o600 });
    return { accountId, publicKey: rec.public_key, privateKey: rec.private_key };
  }
}

async function viewAccountOrNull(provider, accountId) {
  try {
    return await provider.viewAccount({ accountId });
  } catch {
    return null;
  }
}

async function viewJson(provider, contractId, methodName) {
  try {
    const res = await provider.query({
      request_type: 'call_function',
      account_id: contractId,
      method_name: methodName,
      args_base64: Buffer.from('{}').toString('base64'),
      finality: 'optimistic',
    });
    return JSON.parse(Buffer.from(res.result).toString('utf8'));
  } catch {
    return null;
  }
}

async function topUpParentIfNeeded(provider) {
  const view = await provider.viewAccount({ accountId: ROOT_ACCOUNT });
  const balNear = Number(BigInt(view.amount)) / 1e24;
  if (balNear >= 5.6) return null;
  const relayerCred = await readCredential(RELAYER_ACCOUNT);
  const relayer = new Account(RELAYER_ACCOUNT, provider, KeyPairSigner.fromSecretKey(relayerCred.privateKey));
  const outcome = await relayer.transfer({ receiverId: ROOT_ACCOUNT, amount: nearToYocto('2.00') });
  return outcome.transaction?.hash || outcome.transaction_outcome?.id;
}

async function deployOne(provider, parent, spec) {
  const wasm = await fs.readFile(path.resolve(spec.wasmPath));
  const cred = await ensureSubCredential(spec.accountId);
  const txs = {};
  let view = await viewAccountOrNull(provider, spec.accountId);
  if (!view) {
    const out = await parent.createAccount({
      newAccountId: spec.accountId,
      publicKey: PublicKey.fromString(cred.publicKey),
      nearToTransfer: nearToYocto(spec.initialNear),
    });
    txs.createAccount = out.transaction?.hash || out.transaction_outcome?.id;
    view = await viewAccountOrNull(provider, spec.accountId);
  }
  const sub = new Account(spec.accountId, provider, KeyPairSigner.fromSecretKey(cred.privateKey));
  if (REDEPLOY || view?.code_hash === '11111111111111111111111111111111') {
    const out = await sub.deployContract(wasm);
    txs.deployContract = out.transaction?.hash || out.transaction_outcome?.id;
  }
  const ownerBefore = await viewJson(provider, spec.accountId, 'get_owner');
  if (!ownerBefore) {
    const out = await sub.callFunctionRaw({
      contractId: spec.accountId,
      methodName: 'new',
      args: { owner_id: ROOT_ACCOUNT, operator_id: OPERATOR_ACCOUNT },
      gas: teraToGas(50),
    });
    txs.init = out.transaction?.hash || out.transaction_outcome?.id;
  }
  const finalView = await provider.viewAccount({ accountId: spec.accountId });
  const owner = await viewJson(provider, spec.accountId, 'get_owner');
  const operator = await viewJson(provider, spec.accountId, 'get_operator');
  return {
    accountId: spec.accountId,
    wasmBytes: wasm.length,
    wasmSha256Base58: createHash('sha256').update(wasm).digest('base64'),
    codeHash: finalView.code_hash,
    balanceNear: (Number(BigInt(finalView.amount)) / 1e24).toFixed(4),
    owner,
    operator,
    txs,
  };
}

async function main() {
  const provider = new JsonRpcProvider({ url: RPC_URL });
  const rootCred = await readCredential(ROOT_ACCOUNT);
  const parent = new Account(ROOT_ACCOUNT, provider, KeyPairSigner.fromSecretKey(rootCred.privateKey));
  const topUpTx = await topUpParentIfNeeded(provider);
  const results = [];
  for (const spec of SPECS) {
    results.push(await deployOne(provider, parent, spec));
  }
  const rootView = await provider.viewAccount({ accountId: ROOT_ACCOUNT });
  const relayerView = await provider.viewAccount({ accountId: RELAYER_ACCOUNT });
  console.log(JSON.stringify({
    rpcUrl: RPC_URL,
    topUpTx,
    deployed: results,
    remainingBalancesNear: {
      [ROOT_ACCOUNT]: (Number(BigInt(rootView.amount)) / 1e24).toFixed(4),
      [RELAYER_ACCOUNT]: (Number(BigInt(relayerView.amount)) / 1e24).toFixed(4),
    },
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
