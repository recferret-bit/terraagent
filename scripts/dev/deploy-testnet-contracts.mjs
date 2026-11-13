#!/usr/bin/env node
/**
 * Deploys and initializes all 6 TerraAgent NEAR contracts (`res`, `deed`, `bounty`, `staking`, `dao`, `pilots`)
 * and ensures core protocol accounts (`relayer`, `minter`, `protocol`) on NEAR Testnet or Mainnet.
 * Reads keys from `~/.near-credentials/<network>` (never logs private keys).
 *
 * Usage:
 *   node scripts/dev/deploy-testnet-contracts.mjs [--network testnet|mainnet] [--only pilots,staking] [--ensure-accounts] [--redeploy] [--dry-run]
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
  let ensureAccounts = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--redeploy') redeploy = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--ensure-accounts') ensureAccounts = true;
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
  return { network, only, redeploy, dryRun, ensureAccounts };
}

function buildNetworkTarget(network) {
  const isMainnet = network === 'mainnet';
  const rootAccount = process.env.NEAR_ROOT_ACCOUNT || (isMainnet ? 'terraagent.near' : 'terraagent.testnet');
  const relayerAccount = process.env.NEAR_RELAYER_ACCOUNT || `relayer.${rootAccount}`;
  const minterAccount = process.env.NEAR_MINTER_ACCOUNT || `minter.${rootAccount}`;
  const protocolAccount = process.env.NEAR_PROTOCOL_ACCOUNT || `protocol.${rootAccount}`;
  const rpcUrl =
    process.env.NEAR_RPC_PRIMARY ||
    process.env.NEAR_RPC_URL ||
    (isMainnet ? 'https://free.rpc.fastnear.com' : 'https://test.rpc.fastnear.com');
  const credsDir = process.env.NEAR_CREDENTIALS_DIR || path.join(os.homedir(), '.near-credentials', network);
  const wasmDir = 'backend/near-contracts/target/wasm32-unknown-unknown/release';

  const coreAccounts = [
    { key: 'relayer', accountId: relayerAccount, initialNear: '2.00' },
    { key: 'minter', accountId: minterAccount, initialNear: '1.50' },
    { key: 'protocol', accountId: protocolAccount, initialNear: '0.10' },
  ];

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
  return { network, rootAccount, relayerAccount, minterAccount, protocolAccount, rpcUrl, credsDir, coreAccounts, specs };
}

function assertTxOutcomeOk(out, label) {
  if (out?.status && typeof out.status === 'object' && 'Failure' in out.status) {
    throw new Error(`${label} transaction failed: ${JSON.stringify(out.status.Failure)}`);
  }
  const receipts = Array.isArray(out?.receipts_outcome) ? out.receipts_outcome : [];
  for (const receipt of receipts) {
    const status = receipt?.outcome?.status;
    if (status && typeof status === 'object' && 'Failure' in status) {
      throw new Error(`${label} receipt failed (${receipt.id}): ${JSON.stringify(status.Failure)}`);
    }
  }
}

async function readCredential(credsDir, accountId, envSecretKey) {
  if (envSecretKey && process.env[envSecretKey]) {
    const secret = process.env[envSecretKey].trim();
    const kp = KeyPair.fromString(secret);
    return { accountId, publicKey: kp.getPublicKey().toString(), privateKey: secret };
  }
  const file = path.join(credsDir, `${accountId}.json`);
  const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
  const privateKey = parsed.private_key || parsed.secret_key;
  return { accountId: parsed.account_id || accountId, publicKey: parsed.public_key, privateKey };
}

async function ensureSubCredential(credsDir, accountId) {
  try {
    return await readCredential(credsDir, accountId);
  } catch {
    const kp = KeyPair.fromRandom('ed25519');
    const rec = { account_id: accountId, public_key: kp.getPublicKey().toString(), private_key: kp.toString() };
    await fs.mkdir(credsDir, { recursive: true, mode: 0o700 });
    const file = path.join(credsDir, `${accountId}.json`);
    await fs.writeFile(file, `${JSON.stringify(rec, null, 2)}\n`, { mode: 0o600 });
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

async function ensureCoreAccounts(provider, parent, credsDir, coreAccounts) {
  const provisioned = [];
  for (const acc of coreAccounts) {
    const existing = await viewAccountOrNull(provider, acc.accountId);
    if (existing) {
      provisioned.push({
        key: acc.key,
        accountId: acc.accountId,
        created: false,
        balanceNear: (Number(BigInt(existing.amount)) / 1e24).toFixed(4),
      });
      continue;
    }
    const cred = await ensureSubCredential(credsDir, acc.accountId);
    const out = await parent.createAccount({
      newAccountId: acc.accountId,
      publicKey: PublicKey.fromString(cred.publicKey),
      nearToTransfer: nearToYocto(acc.initialNear),
    });
    assertTxOutcomeOk(out, `createAccount(${acc.accountId})`);
    const createdView = await provider.viewAccount({ accountId: acc.accountId });
    provisioned.push({
      key: acc.key,
      accountId: acc.accountId,
      created: true,
      txHash: out.transaction?.hash || out.transaction_outcome?.id,
      balanceNear: (Number(BigInt(createdView.amount)) / 1e24).toFixed(4),
    });
  }
  return provisioned;
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
    protocolAccount: target.protocolAccount,
    contracts,
  };
}

async function deployOne(provider, parent, target, spec, redeploy) {
  const { credsDir, rootAccount, protocolAccount } = target;
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
    assertTxOutcomeOk(out, `createAccount(${spec.accountId})`);
    txs.createAccount = out.transaction?.hash || out.transaction_outcome?.id;
    view = await viewAccountOrNull(provider, spec.accountId);
  }
  const sub = new Account(spec.accountId, provider, KeyPairSigner.fromSecretKey(cred.privateKey));
  if (redeploy || view?.code_hash === '11111111111111111111111111111111') {
    const out = await sub.deployContract(wasm);
    assertTxOutcomeOk(out, `deployContract(${spec.accountId})`);
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
    assertTxOutcomeOk(out, `init(${spec.accountId})`);
    txs.init = out.transaction?.hash || out.transaction_outcome?.id;
  }
  if (spec.key === 'staking' && protocolAccount !== `protocol.${rootAccount}`) {
    const out = await parent.callFunctionRaw({
      contractId: spec.accountId,
      methodName: 'set_protocol_account',
      args: { protocol_id: protocolAccount },
      gas: teraToGas(30),
    });
    assertTxOutcomeOk(out, `set_protocol_account(${spec.accountId})`);
    txs.setProtocolAccount = out.transaction?.hash || out.transaction_outcome?.id;
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
  const rootCred = await readCredential(target.credsDir, target.rootAccount, 'NEAR_ROOT_SECRET_KEY');
  const parent = new Account(target.rootAccount, provider, KeyPairSigner.fromSecretKey(rootCred.privateKey));
  const accounts = (!opts.only || opts.ensureAccounts)
    ? await ensureCoreAccounts(provider, parent, target.credsDir, target.coreAccounts)
    : undefined;

  const results = [];
  for (const spec of selectedSpecs) {
    results.push(await deployOne(provider, parent, target, spec, opts.redeploy));
  }
  const rootView = await provider.viewAccount({ accountId: target.rootAccount });
  const relayerView = await viewAccountOrNull(provider, target.relayerAccount);
  const protocolView = await viewAccountOrNull(provider, target.protocolAccount);
  console.log(JSON.stringify({
    network: target.network,
    rpcUrl: target.rpcUrl,
    ...(accounts ? { coreAccounts: accounts } : {}),
    deployed: results,
    remainingBalancesNear: {
      [target.rootAccount]: (Number(BigInt(rootView.amount)) / 1e24).toFixed(4),
      ...(relayerView ? { [target.relayerAccount]: (Number(BigInt(relayerView.amount)) / 1e24).toFixed(4) } : {}),
      ...(protocolView ? { [target.protocolAccount]: (Number(BigInt(protocolView.amount)) / 1e24).toFixed(4) } : {}),
    },
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
