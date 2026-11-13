#!/usr/bin/env node
/**
 * Deploys and initializes all 6 TerraAgent NEAR contracts (`res`, `deed`, `bounty`, `staking`, `dao`, `pilots`)
 * on NEAR Testnet or Mainnet (`--network testnet|mainnet`, `--only <csv>`, `--redeploy`, `--dry-run`).
 * Reads keys from `~/.near-credentials/<network>` (never logs private keys).
 *
 * Usage:
 *   node scripts/dev/deploy-testnet-contracts.mjs [--network testnet|mainnet] [--only pilots,staking] [--redeploy] [--dry-run]
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, PublicKey, nearToYocto, teraToGas } from 'near-api-js';

function parseCliArgs(argv) {
  let network = (process.env.NEAR_NETWORK || process.env.NEAR_MODE || 'testnet').trim().toLowerCase();
  if (network !== 'mainnet') network = 'testnet';
  let only = null;
  let redeploy = false;
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--redeploy') redeploy = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--network' && argv[i + 1]) {
      network = argv[i + 1].trim().toLowerCase();
      i += 1;
    } else if (arg.startsWith('--network=')) {
      network = arg.slice('--network='.length).trim().toLowerCase();
    } else if (arg === '--only' && argv[i + 1]) {
      only = new Set(argv[i + 1].split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
      i += 1;
    } else if (arg.startsWith('--only=')) {
      only = new Set(arg.slice('--only='.length).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
    } else {
      throw new Error(`Unknown CLI argument: ${arg}`);
    }
  }

  if (network !== 'testnet' && network !== 'mainnet') {
    throw new Error(`Invalid --network "${network}" (expected testnet or mainnet)`);
  }
  const allowMainnet = process.env.NEAR_ALLOW_MAINNET === '1' || process.env.NEAR_ALLOW_MAINNET === 'true';
  if (network === 'mainnet' && !dryRun && !allowMainnet) {
    throw new Error('Refusing live mainnet contract deployment without NEAR_ALLOW_MAINNET=1.');
  }
  return { network, only, redeploy, dryRun };
}

function buildNetworkTarget(network) {
  const isMainnet = network === 'mainnet';
  const rootAccount = process.env.NEAR_ROOT_ACCOUNT || (isMainnet ? 'terraagent.near' : 'terraagent.testnet');
  const relayerAccount = process.env.NEAR_RELAYER_ACCOUNT || `relayer.${rootAccount}`;
  const minterAccount = process.env.NEAR_MINTER_ACCOUNT || `minter.${rootAccount}`;
  const rpcUrl = process.env.NEAR_RPC_PRIMARY || (isMainnet ? 'https://free.rpc.fastnear.com' : 'https://test.rpc.fastnear.com');
  const credsDir = process.env.NEAR_CREDENTIALS_DIR || path.join(os.homedir(), '.near-credentials', network);
  const wasmDir = 'backend/near-contracts/target/wasm32-unknown-unknown/release';

  const specs = [
    {
      key: 'res',
      accountId: process.env.NEAR_CONTRACT_RES || `res.${rootAccount}`,
      initialNear: '2.50',
      wasmPath: `${wasmDir}/terra_res_contract.wasm`,
      probeMethod: 'get_minter',
      probeArgs: {},
      initArgs: { owner_id: rootAccount, minter_id: minterAccount },
    },
    {
      key: 'deed',
      accountId: process.env.NEAR_CONTRACT_DEED || `deed.${rootAccount}`,
      initialNear: '2.50',
      wasmPath: `${wasmDir}/terra_deed_contract.wasm`,
      probeMethod: 'nft_token',
      probeArgs: { token_id: '__init_probe__' },
      initArgs: { owner_id: rootAccount, operator_id: minterAccount },
    },
    {
      key: 'bounty',
      accountId: process.env.NEAR_CONTRACT_BOUNTY || `bounty.${rootAccount}`,
      initialNear: '2.40',
      wasmPath: `${wasmDir}/terra_bounty_contract.wasm`,
      probeMethod: 'get_escrow',
      probeArgs: { escrow_id: '__init_probe__' },
      initArgs: { owner_id: rootAccount, operator_id: minterAccount },
    },
    {
      key: 'staking',
      accountId: process.env.NEAR_CONTRACT_STAKING || `staking.${rootAccount}`,
      initialNear: '2.45',
      wasmPath: `${wasmDir}/terra_staking_contract.wasm`,
      probeMethod: 'get_owner',
      probeArgs: {},
      initArgs: { owner_id: rootAccount, operator_id: minterAccount },
    },
    {
      key: 'dao',
      accountId: process.env.NEAR_CONTRACT_DAO || `dao.${rootAccount}`,
      initialNear: '2.65',
      wasmPath: `${wasmDir}/terra_dao_contract.wasm`,
      probeMethod: 'get_owner',
      probeArgs: {},
      initArgs: { owner_id: rootAccount, operator_id: minterAccount },
    },
    {
      key: 'pilots',
      accountId: process.env.NEAR_CONTRACT_PILOTS || `pilots.${rootAccount}`,
      initialNear: '2.40',
      wasmPath: `${wasmDir}/terra_pilots_contract.wasm`,
      probeMethod: 'get_owner',
      probeArgs: {},
      initArgs: { owner_id: rootAccount, operator_id: relayerAccount },
    },
  ];
  return { network, rootAccount, relayerAccount, minterAccount, rpcUrl, credsDir, specs };
}

async function readCredential(credsDir, accountId) {
  const file = path.join(credsDir, `${accountId}.json`);
  const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
  return { accountId: parsed.account_id || accountId, publicKey: parsed.public_key, privateKey: parsed.private_key };
}

async function ensureSubCredential(credsDir, accountId) {
  const file = path.join(credsDir, `${accountId}.json`);
  try {
    return await readCredential(credsDir, accountId);
  } catch {
    const kp = KeyPair.fromRandom('ed25519');
    const rec = { account_id: accountId, public_key: kp.getPublicKey().toString(), private_key: kp.toString() };
    await fs.mkdir(credsDir, { recursive: true });
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

async function isContractInitialized(provider, contractId, methodName, args) {
  try {
    await provider.query({
      request_type: 'call_function',
      account_id: contractId,
      method_name: methodName,
      args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
      finality: 'optimistic',
    });
    return true;
  } catch {
    return false;
  }
}

async function buildDryRunReport(target, selectedSpecs) {
  const contracts = [];
  for (const spec of selectedSpecs) {
    const wasm = await fs.readFile(path.resolve(spec.wasmPath));
    contracts.push({
      key: spec.key,
      accountId: spec.accountId,
      initialNear: spec.initialNear,
      wasmBytes: wasm.length,
      wasmSha256Base64: createHash('sha256').update(wasm).digest('base64'),
      initArgs: spec.initArgs,
    });
  }
  return {
    dryRun: true,
    network: target.network,
    rpcUrl: target.rpcUrl,
    rootAccount: target.rootAccount,
    relayerAccount: target.relayerAccount,
    minterAccount: target.minterAccount,
    contracts,
  };
}

async function deployOne(provider, parent, credsDir, spec, redeploy) {
  const wasm = await fs.readFile(path.resolve(spec.wasmPath));
  const cred = await ensureSubCredential(credsDir, spec.accountId);
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
  if (redeploy || view?.code_hash === '11111111111111111111111111111111') {
    const out = await sub.deployContract(wasm);
    txs.deployContract = out.transaction?.hash || out.transaction_outcome?.id;
  }
  const initialized = await isContractInitialized(provider, spec.accountId, spec.probeMethod, spec.probeArgs);
  if (!initialized) {
    const out = await sub.callFunctionRaw({
      contractId: spec.accountId,
      methodName: 'new',
      args: spec.initArgs,
      gas: teraToGas(50),
    });
    txs.init = out.transaction?.hash || out.transaction_outcome?.id;
  }
  const finalView = await provider.viewAccount({ accountId: spec.accountId });
  return {
    key: spec.key,
    accountId: spec.accountId,
    wasmBytes: wasm.length,
    wasmSha256Base64: createHash('sha256').update(wasm).digest('base64'),
    codeHash: finalView.code_hash,
    balanceNear: (Number(BigInt(finalView.amount)) / 1e24).toFixed(4),
    initArgs: spec.initArgs,
    txs,
  };
}

async function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  const target = buildNetworkTarget(opts.network);
  const selectedSpecs = opts.only
    ? target.specs.filter((s) => opts.only.has(s.key))
    : target.specs;
  if (selectedSpecs.length === 0) {
    throw new Error(`No contracts matched --only filter (available: ${target.specs.map((s) => s.key).join(', ')})`);
  }

  if (opts.dryRun) {
    console.log(JSON.stringify(await buildDryRunReport(target, selectedSpecs), null, 2));
    return;
  }

  const provider = new JsonRpcProvider({ url: target.rpcUrl });
  const rootCred = await readCredential(target.credsDir, target.rootAccount);
  const parent = new Account(target.rootAccount, provider, KeyPairSigner.fromSecretKey(rootCred.privateKey));
  const results = [];
  for (const spec of selectedSpecs) {
    results.push(await deployOne(provider, parent, target.credsDir, spec, opts.redeploy));
  }
  const rootView = await provider.viewAccount({ accountId: target.rootAccount });
  const relayerView = await viewAccountOrNull(provider, target.relayerAccount);
  console.log(JSON.stringify({
    network: target.network,
    rpcUrl: target.rpcUrl,
    deployed: results,
    remainingBalancesNear: {
      [target.rootAccount]: (Number(BigInt(rootView.amount)) / 1e24).toFixed(4),
      ...(relayerView ? { [target.relayerAccount]: (Number(BigInt(relayerView.amount)) / 1e24).toFixed(4) } : {}),
    },
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
