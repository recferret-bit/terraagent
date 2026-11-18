#!/usr/bin/env node
/**
 * Inspects liquid NEAR and contract storage headroom across TerraAgent Testnet accounts & contracts.
 * Defaults to read-only `--dry-run`; pass `--apply` explicitly (never auto-run) to send Testnet top-ups.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, nearToYocto } from 'near-api-js';

const STORAGE_BYTE_COST = 10n ** 19n;
const DEFAULT_FAUCET_URL = 'https://helper.testnet.near.org/account';

function parseArgs(argv) {
  let apply = false;
  let faucet = false;
  let rootAccount = process.env.NEAR_ROOT_ACCOUNT || 'terraagent.testnet';
  let funderAccount = '';
  let rpcUrl = process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com';
  let only = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') apply = true;
    else if (a === '--faucet') {
      faucet = true;
      apply = true;
    } else if (a === '--dry-run') apply = false;
    else if (a === '--root' && argv[i + 1]) {
      rootAccount = argv[++i];
    } else if (a === '--funder' && argv[i + 1]) {
      funderAccount = argv[++i];
    } else if (a === '--rpc' && argv[i + 1]) {
      rpcUrl = argv[++i];
    } else if (a === '--only' && argv[i + 1]) {
      only = new Set(argv[++i].split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
    }
  }
  if (apply && !rootAccount.endsWith('.testnet')) {
    throw new Error('Refusing --apply on non-testnet root account.');
  }
  return { apply, faucet, rootAccount, funderAccount: funderAccount || rootAccount, rpcUrl, only };
}

function buildTargets(root) {
  return [
    { role: 'contract', accountId: process.env.NEAR_CONTRACT_RES || `res.${root}`, minHeadroomNear: 1.0, topupTargetNear: 3.0 },
    { role: 'contract', accountId: process.env.NEAR_CONTRACT_DEED || `deed.${root}`, minHeadroomNear: 2.0, topupTargetNear: 5.0 },
    { role: 'contract', accountId: process.env.NEAR_CONTRACT_BOUNTY || `bounty.${root}`, minHeadroomNear: 1.0, topupTargetNear: 3.0 },
    { role: 'contract', accountId: process.env.NEAR_CONTRACT_STAKING || `staking.${root}`, minHeadroomNear: 1.0, topupTargetNear: 3.0 },
    { role: 'contract', accountId: process.env.NEAR_CONTRACT_DAO || `dao.${root}`, minHeadroomNear: 2.0, topupTargetNear: 5.0 },
    { role: 'contract', accountId: process.env.NEAR_CONTRACT_PILOTS || `pilots.${root}`, minHeadroomNear: 1.0, topupTargetNear: 2.0 },
    { role: 'operator', accountId: process.env.NEAR_RELAYER_ACCOUNT || `relayer.${root}`, minHeadroomNear: 5.0, topupTargetNear: 15.0 },
    { role: 'operator', accountId: process.env.NEAR_MINTER_ACCOUNT || `minter.${root}`, minHeadroomNear: 3.0, topupTargetNear: 10.0 },
    { role: 'treasury', accountId: process.env.NEAR_PROTOCOL_ACCOUNT || `protocol.${root}`, minHeadroomNear: 0.25, topupTargetNear: 1.0 },
  ];
}

async function inspectTarget(provider, target) {
  try {
    const view = await provider.viewAccount({ accountId: target.accountId });
    const totalYocto = BigInt(view.amount || '0');
    const storageBytes = Number(view.storage_usage || 0);
    const lockedYocto = BigInt(storageBytes) * STORAGE_BYTE_COST;
    const headroomYocto = totalYocto > lockedYocto ? totalYocto - lockedYocto : 0n;
    const totalNear = Number(totalYocto / 10n ** 18n) / 1e6;
    const lockedNear = Number(lockedYocto / 10n ** 18n) / 1e6;
    const headroomNear = Number(headroomYocto / 10n ** 18n) / 1e6;
    const low = headroomNear < target.minHeadroomNear;
    const recommendedNear = low ? Math.max(0.5, Number((target.topupTargetNear - headroomNear).toFixed(2))) : 0;
    return { ...target, exists: true, totalNear, storageBytes, lockedNear, headroomNear, low, recommendedNear };
  } catch (err) {
    return {
      ...target,
      exists: false,
      totalNear: 0,
      storageBytes: 0,
      lockedNear: 0,
      headroomNear: 0,
      low: true,
      recommendedNear: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function loadAccountSigner(accountId) {
  const credFile = path.join(os.homedir(), '.near-credentials', 'testnet', `${accountId}.json`);
  const raw = JSON.parse(await fs.readFile(credFile, 'utf8'));
  const secretKey = raw.private_key || raw.secret_key;
  if (!secretKey) throw new Error(`Missing private_key in ${credFile}`);
  return KeyPairSigner.fromSecretKey(secretKey);
}

function matchesOnly(row, only) {
  if (!only || only.size === 0) return true;
  const prefix = row.accountId.split('.')[0]?.toLowerCase() ?? '';
  return only.has(row.accountId.toLowerCase()) || only.has(prefix) || only.has(row.role.toLowerCase());
}

async function sweepFaucetToAccount(provider, beneficiaryId) {
  const faucetUrl = process.env.NEAR_FAUCET_URL || DEFAULT_FAUCET_URL;
  const kp = KeyPair.fromRandom('ed25519');
  const tempId = `ta-topup-${Date.now()}-${Math.floor(Math.random() * 1000)}.testnet`;
  const res = await fetch(faucetUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ newAccountId: tempId, newAccountPublicKey: kp.getPublicKey().toString() }),
  });
  if (!res.ok) {
    throw new Error(`Faucet HTTP ${res.status}: ${(await res.text()).slice(0, 180)}`);
  }
  for (let i = 0; i < 8; i += 1) {
    const view = await inspectTarget(provider, { accountId: tempId, minHeadroomNear: 0, topupTargetNear: 0 });
    if (view.exists && view.totalNear > 0.1) {
      const eph = new Account(tempId, provider, new KeyPairSigner(kp));
      const outcome = await eph.deleteAccount(beneficiaryId);
      const hash = outcome.transaction?.hash ?? outcome.transaction_outcome?.id ?? 'unknown';
      console.log(`faucet sweep ${tempId} -> ${beneficiaryId} (~${view.totalNear.toFixed(2)} NEAR) -> tx ${hash}`);
      return view.totalNear;
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error(`Faucet created ${tempId} but account was not visible on RPC in time`);
}

async function ensureFunderBalance(provider, opts, neededNear) {
  let funderView = await inspectTarget(provider, { accountId: opts.funderAccount, minHeadroomNear: 0.1, topupTargetNear: 1 });
  let sweeps = 0;
  while ((opts.faucet && sweeps === 0) || (funderView.headroomNear < neededNear + 0.15 && sweeps < 5)) {
    if (!opts.apply) break;
    try {
      await sweepFaucetToAccount(provider, opts.funderAccount);
      sweeps += 1;
      await new Promise((r) => setTimeout(r, 500));
      funderView = await inspectTarget(provider, { accountId: opts.funderAccount, minHeadroomNear: 0.1, topupTargetNear: 1 });
    } catch (err) {
      console.warn(`faucet note: ${err instanceof Error ? err.message : String(err)}`);
      break;
    }
  }
  return funderView.headroomNear;
}

async function applyTopups(provider, opts, rows) {
  const priorityOrder = (r) => (r.role === 'operator' ? 0 : r.headroomNear < 0.05 ? 1 : 2);
  const candidates = rows
    .filter((r) => r.exists && r.recommendedNear > 0 && matchesOnly(r, opts.only))
    .sort((a, b) => priorityOrder(a) - priorityOrder(b));
  if (candidates.length === 0) {
    console.log('No matching accounts need top-up.');
    return;
  }
  const totalNeeded = candidates.reduce((s, r) => s + r.recommendedNear, 0);
  let available = await ensureFunderBalance(provider, opts, totalNeeded);
  const signer = await loadAccountSigner(opts.funderAccount);
  const funder = new Account(opts.funderAccount, provider, signer);
  for (const row of candidates) {
    const reserve = 0.05;
    const sendNear = Math.min(row.recommendedNear, Math.max(0, Number((available - reserve).toFixed(2))));
    if (sendNear < 0.1) continue;
    const outcome = await funder.transfer({ receiverId: row.accountId, amount: nearToYocto(sendNear.toFixed(2)) });
    available -= sendNear;
    const hash = outcome.transaction?.hash ?? outcome.transaction_outcome?.id ?? 'unknown';
    console.log(`topup ${row.accountId} +${sendNear.toFixed(2)} NEAR (from ${opts.funderAccount}) -> tx ${hash}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const provider = new JsonRpcProvider({ url: opts.rpcUrl }, { retries: 2, wait: 200, backoff: 1.5 });
  const rows = await Promise.all(buildTargets(opts.rootAccount).map((t) => inspectTarget(provider, t)));
  const table = rows.map((r) => ({
    account: r.accountId,
    role: r.role,
    totalNear: r.totalNear.toFixed(4),
    storageLockedNear: r.lockedNear.toFixed(4),
    liquidHeadroomNear: r.headroomNear.toFixed(4),
    status: !r.exists ? 'MISSING' : r.low ? `LOW (+${r.recommendedNear.toFixed(2)} NEAR)` : 'OK',
  }));
  console.table(table);
  if (opts.apply) {
    await applyTopups(provider, opts, rows);
  } else {
    const need = rows.filter((r) => r.recommendedNear > 0);
    console.log(`Dry-run complete (${need.length} account(s) below threshold). Re-run with --apply to broadcast Testnet top-ups.`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
