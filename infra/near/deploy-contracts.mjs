#!/usr/bin/env node
/**
 * Builds and deploys TerraAgent's Rust NEAR smart contracts (`res`, `deed`, `bounty`)
 * and provisions `relayer.<root>` and `minter.<root>` sub-accounts on NEAR testnet/mainnet.
 *
 * Usage:
 *   node infra/near/deploy-contracts.mjs [all|accounts|res|deed|bounty]
 *
 * Reads root credentials from `NEAR_ROOT_SECRET_KEY` or `~/.near-credentials/<network>/<root>.json`
 * and writes sub-account credentials to `~/.near-credentials/<network>/<subaccount>.json` (mode 0600, never logged).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, actions, nearToYocto, teraToGas } from 'near-api-js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const NETWORK = process.env.NEAR_NETWORK ?? 'testnet';
const ROOT_ACCOUNT = process.env.NEAR_ROOT_ACCOUNT ?? (NETWORK === 'mainnet' ? 'terraagent.near' : 'terraagent.testnet');
const CRED_DIR = path.join(os.homedir(), '.near-credentials', NETWORK);
const EXPLORER = NETWORK === 'mainnet' ? 'https://nearblocks.io/txns' : 'https://testnet.nearblocks.io/txns';

const CONTRACTS = {
  res: {
    sub: 'res',
    wasm: 'terra_res_contract.wasm',
    fundNear: '2.5',
    initArgs: (minter) => ({ owner_id: ROOT_ACCOUNT, minter_id: minter }),
  },
  deed: {
    sub: 'deed',
    wasm: 'terra_deed_contract.wasm',
    fundNear: '2.5',
    initArgs: (minter) => ({ owner_id: ROOT_ACCOUNT, operator_id: minter }),
  },
  bounty: {
    sub: 'bounty',
    wasm: 'terra_bounty_contract.wasm',
    fundNear: '2.4',
    initArgs: (minter) => ({ owner_id: ROOT_ACCOUNT, operator_id: minter }),
  },
};

function makeProvider() {
  const urls = NETWORK === 'mainnet'
    ? [process.env.NEAR_RPC_URL ?? 'https://free.rpc.fastnear.com', 'https://rpc.mainnet.near.org']
    : [process.env.NEAR_RPC_URL ?? 'https://test.rpc.fastnear.com', 'https://rpc.testnet.near.org'];
  return new FailoverRpcProvider(urls.map((url) => new JsonRpcProvider({ url })));
}

function loadSecretKey(accountId, envKey) {
  if (envKey && process.env[envKey]) return process.env[envKey];
  const file = path.join(CRED_DIR, `${accountId}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Missing key for ${accountId}: set ${envKey ?? 'NEAR_ROOT_SECRET_KEY'} or place ${file}`);
  }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const secret = parsed.private_key ?? parsed.secret_key;
  if (!secret) throw new Error(`Credential file ${file} has no private_key`);
  return secret;
}

function saveCredential(accountId, keyPair) {
  fs.mkdirSync(CRED_DIR, { recursive: true, mode: 0o700 });
  const file = path.join(CRED_DIR, `${accountId}.json`);
  const body = JSON.stringify(
    {
      account_id: accountId,
      public_key: keyPair.getPublicKey().toString(),
      private_key: keyPair.toString(),
    },
    null,
    2,
  );
  fs.writeFileSync(file, `${body}\n`, { mode: 0o600 });
}

async function accountExists(provider, accountId) {
  try {
    await provider.viewAccount({ accountId });
    return true;
  } catch {
    return false;
  }
}

async function ensureSubAccount(provider, rootAccount, subName, fundNear) {
  const subId = `${subName}.${ROOT_ACCOUNT}`;
  if (await accountExists(provider, subId)) {
    console.log(`[skip] ${subId} already exists`);
    return subId;
  }
  const keyPair = KeyPair.fromRandom('ed25519');
  const tx = await rootAccount.createAccount({
    newAccountId: subId,
    publicKey: keyPair.getPublicKey(),
    nearToTransfer: nearToYocto(fundNear),
  });
  saveCredential(subId, keyPair);
  console.log(`[ok] created ${subId} (${fundNear} NEAR) -> ${EXPLORER}/${tx.transaction.hash}`);
  return subId;
}

function buildWasmArtifacts() {
  console.log('[build] compiling Rust NEAR smart contracts (wasm32-unknown-unknown --release)...');
  const res = spawnSync(
    'cargo',
    ['build', '--manifest-path', 'backend/near-contracts/Cargo.toml', '--release', '--target', 'wasm32-unknown-unknown'],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  );
  if (res.status !== 0) throw new Error('cargo build failed');
}

async function deployOne(provider, rootAccount, key) {
  const spec = CONTRACTS[key];
  const contractId = `${spec.sub}.${ROOT_ACCOUNT}`;
  const minterId = `minter.${ROOT_ACCOUNT}`;
  const wasmPath = path.join(REPO_ROOT, 'backend/near-contracts/target/wasm32-unknown-unknown/release', spec.wasm);
  const wasmBytes = fs.readFileSync(wasmPath);

  if (!(await accountExists(provider, contractId))) {
    const keyPair = KeyPair.fromRandom('ed25519');
    const tx = await rootAccount.signAndSendTransaction({
      receiverId: contractId,
      actions: [
        actions.createAccount(),
        actions.transfer(nearToYocto(spec.fundNear)),
        actions.addFullAccessKey(keyPair.getPublicKey()),
        actions.deployContract(wasmBytes),
        actions.functionCall('new', spec.initArgs(minterId), teraToGas(50), 0n),
      ],
    });
    saveCredential(contractId, keyPair);
    console.log(`[ok] deployed + initialized ${contractId} (${wasmBytes.length} bytes) -> ${EXPLORER}/${tx.transaction.hash}`);
    return;
  }

  const contractSecret = loadSecretKey(contractId);
  const contractAccount = new Account(contractId, provider, contractSecret);
  const tx = await contractAccount.deployContract(wasmBytes);
  console.log(`[ok] upgraded ${contractId} (${wasmBytes.length} bytes) -> ${EXPLORER}/${tx.transaction.hash}`);
}

async function main() {
  const target = process.argv[2] ?? 'all';
  const valid = new Set(['all', 'accounts', 'res', 'deed', 'bounty']);
  if (!valid.has(target)) {
    throw new Error(`Usage: node infra/near/deploy-contracts.mjs [all|accounts|res|deed|bounty] (got "${target}")`);
  }
  if (NETWORK === 'mainnet' && process.env.NEAR_ALLOW_MAINNET !== '1') {
    throw new Error('Refusing mainnet deploy without NEAR_ALLOW_MAINNET=1');
  }

  const provider = makeProvider();
  const rootSecret = loadSecretKey(ROOT_ACCOUNT, 'NEAR_ROOT_SECRET_KEY');
  const rootAccount = new Account(ROOT_ACCOUNT, provider, rootSecret);

  await ensureSubAccount(provider, rootAccount, 'relayer', '6');
  await ensureSubAccount(provider, rootAccount, 'minter', '1.5');
  if (target === 'accounts') return;

  buildWasmArtifacts();
  const keys = target === 'all' ? ['res', 'deed', 'bounty'] : [target];
  for (const k of keys) {
    await deployOne(provider, rootAccount, k);
  }
}

main().catch((err) => {
  console.error('[near:deploy] failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
