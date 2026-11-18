use std::collections::{BTreeMap, BTreeSet};
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, PanicOnDefault};
use serde_json::json;

const NEP413_TAG: u32 = 2_147_484_061; // 2^31 + 413
const DEFAULT_RECIPIENT: &str = "intents.near";
const BASE58_ALPHABET: &[u8; 58] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TokenDiffLeg {
    #[serde(rename = "accountId")]
    pub account_id: String,
    pub deltas: BTreeMap<String, String>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SignedTokenDiffIntent {
    pub diff: TokenDiffLeg,
    pub signature: String,
    pub nonce: String,
    #[serde(rename = "deadlineMs")]
    pub deadline_ms: u64,
    #[serde(rename = "publicKey")]
    pub public_key: String,
    pub recipient: Option<String>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SimulationView {
    pub ok: bool,
    pub error_code: Option<String>,
    pub intent_count: u32,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExecutionReceiptView {
    pub op_id: String,
    pub settled_intents: u32,
    pub tokens: Vec<String>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct IntentVerifierContract {
    owner_id: AccountId,
    operator_id: AccountId,
    strict_balances: bool,
    public_keys: LookupMap<String, bool>,
    account_key_counts: LookupMap<String, u32>,
    balances: LookupMap<String, i128>,
    used_nonces: LookupMap<String, bool>,
    processed_ops: LookupMap<String, ExecutionReceiptView>,
}

fn decode_base58(raw: &str) -> Result<Vec<u8>, &'static str> {
    if raw.is_empty() {
        return Err("empty base58");
    }
    let mut bytes: Vec<u8> = vec![0];
    for ch in raw.bytes() {
        let pos = BASE58_ALPHABET
            .iter()
            .position(|&c| c == ch)
            .ok_or("invalid base58 char")? as u32;
        let mut carry = pos;
        for b in bytes.iter_mut() {
            carry += (*b as u32) * 58;
            *b = (carry & 0xff) as u8;
            carry >>= 8;
        }
        while carry > 0 {
            bytes.push((carry & 0xff) as u8);
            carry >>= 8;
        }
    }
    let zeros = raw.bytes().take_while(|&b| b == b'1').count();
    let mut out = vec![0u8; zeros];
    for &b in bytes.iter().rev() {
        if out.len() > zeros || b != 0 {
            out.push(b);
        }
    }
    Ok(out)
}

fn decode_base64(raw: &str) -> Result<Vec<u8>, &'static str> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() % 4 != 0 {
        return Err("invalid base64 length");
    }
    let mut out = Vec::with_capacity((trimmed.len() / 4) * 3);
    let bytes = trimmed.as_bytes();
    for chunk in bytes.chunks_exact(4) {
        let mut vals = [0u8; 4];
        let mut pad = 0usize;
        for i in 0..4 {
            let c = chunk[i];
            if c == b'=' && i >= 2 {
                pad += 1;
                vals[i] = 0;
            } else {
                vals[i] = match c {
                    b'A'..=b'Z' => c - b'A',
                    b'a'..=b'z' => c - b'a' + 26,
                    b'0'..=b'9' => c - b'0' + 52,
                    b'+' | b'-' => 62,
                    b'/' | b'_' => 63,
                    _ => return Err("invalid base64 char"),
                };
            }
        }
        out.push((vals[0] << 2) | (vals[1] >> 4));
        if pad < 2 {
            out.push((vals[1] << 4) | (vals[2] >> 2));
        }
        if pad == 0 {
            out.push((vals[2] << 6) | vals[3]);
        }
    }
    Ok(out)
}

fn iso8601_utc(ms: u64) -> String {
    let secs = (ms / 1_000) as i64;
    let millis = ms % 1_000;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let hour = rem / 3_600;
    let min = (rem % 3_600) / 60;
    let sec = rem % 60;
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = y + if m <= 2 { 1 } else { 0 };
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year, m, d, hour, min, sec, millis
    )
}

fn borsh_str(buf: &mut Vec<u8>, s: &str) {
    let bytes = s.as_bytes();
    buf.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    buf.extend_from_slice(bytes);
}

fn canonical_token_diff_message(intent: &SignedTokenDiffIntent) -> String {
    let mut sorted = BTreeMap::new();
    for (k, v) in &intent.diff.deltas {
        sorted.insert(k.as_str(), v.as_str());
    }
    json!({
        "signer_id": intent.diff.account_id,
        "deadline": iso8601_utc(intent.deadline_ms),
        "intents": [{
            "intent": "token_diff",
            "diff": sorted,
        }]
    })
    .to_string()
}

fn nep413_hash(intent: &SignedTokenDiffIntent, nonce32: &[u8; 32]) -> Vec<u8> {
    let msg = canonical_token_diff_message(intent);
    let recipient = intent.recipient.as_deref().unwrap_or(DEFAULT_RECIPIENT);
    let mut borsh = Vec::with_capacity(64 + msg.len() + recipient.len());
    borsh.extend_from_slice(&NEP413_TAG.to_le_bytes());
    borsh_str(&mut borsh, &msg);
    borsh.extend_from_slice(nonce32);
    borsh_str(&mut borsh, recipient);
    borsh.push(0u8);
    env::sha256(&borsh)
}

fn decode_ed25519_32(prefixed: &str) -> Result<[u8; 32], &'static str> {
    let body = prefixed
        .strip_prefix("ed25519:")
        .ok_or("NEAR_INTENT_BAD_SIGNATURE")?;
    let raw = decode_base58(body).map_err(|_| "NEAR_INTENT_BAD_SIGNATURE")?;
    raw.try_into().map_err(|_| "NEAR_INTENT_BAD_SIGNATURE")
}

fn decode_ed25519_64(prefixed: &str) -> Result<[u8; 64], &'static str> {
    let body = prefixed
        .strip_prefix("ed25519:")
        .ok_or("NEAR_INTENT_BAD_SIGNATURE")?;
    let raw = decode_base58(body).map_err(|_| "NEAR_INTENT_BAD_SIGNATURE")?;
    raw.try_into().map_err(|_| "NEAR_INTENT_BAD_SIGNATURE")
}

fn nonce_key(account_id: &str, nonce: &str) -> String {
    format!("{}|{}", account_id, nonce)
}

fn key_reg_key(account_id: &str, public_key: &str) -> String {
    format!("{}|{}", account_id, public_key)
}

fn bal_key(account_id: &str, token_id: &str) -> String {
    format!("{}|{}", account_id, token_id)
}

fn is_implicit_hex_account(account_id: &str) -> bool {
    account_id.len() == 64
        && account_id
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn hex_encode_32(bytes: &[u8; 32]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(64);
    for &b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

#[near]
impl IntentVerifierContract {
    #[init]
    pub fn new(owner_id: AccountId, operator_id: AccountId, strict_balances: Option<bool>) -> Self {
        Self {
            owner_id,
            operator_id,
            strict_balances: strict_balances.unwrap_or(false),
            public_keys: LookupMap::new(b"k"),
            account_key_counts: LookupMap::new(b"c"),
            balances: LookupMap::new(b"b"),
            used_nonces: LookupMap::new(b"n"),
            processed_ops: LookupMap::new(b"o"),
        }
    }

    pub fn set_strict_balances(&mut self, strict: bool) {
        let caller = env::predecessor_account_id();
        require!(
            caller == self.owner_id || caller == self.operator_id,
            "NEAR_NOT_OWNER: only owner/operator may update strict_balances"
        );
        self.strict_balances = strict;
    }

    pub fn add_public_key(&mut self, public_key: String) {
        let caller = env::predecessor_account_id();
        self.insert_account_key(caller.as_str(), &public_key);
    }

    pub fn register_account_key(&mut self, account_id: String, public_key: String) {
        let caller = env::predecessor_account_id();
        require!(
            caller == self.owner_id || caller == self.operator_id,
            "NEAR_NOT_OWNER: only owner/operator may register account keys"
        );
        self.insert_account_key(&account_id, &public_key);
    }

    pub fn remove_public_key(&mut self, public_key: String) {
        let caller = env::predecessor_account_id();
        let reg_key = key_reg_key(caller.as_str(), &public_key);
        if self.public_keys.remove(&reg_key) == Some(true) {
            let count = self
                .account_key_counts
                .get(caller.as_str())
                .copied()
                .unwrap_or(0);
            if count <= 1 {
                self.account_key_counts.remove(caller.as_str());
            } else {
                self.account_key_counts
                    .insert(caller.as_str().to_string(), count - 1);
            }
        }
    }

    pub fn has_public_key(&self, account_id: String, public_key: String) -> bool {
        self.public_keys
            .get(&key_reg_key(&account_id, &public_key))
            .copied()
            .unwrap_or(false)
    }

    pub fn account_key_count(&self, account_id: String) -> u32 {
        self.account_key_counts
            .get(&account_id)
            .copied()
            .unwrap_or(0)
    }

    pub fn deposit_balance(&mut self, account_id: String, token_id: String, amount: String) -> String {
        let caller = env::predecessor_account_id();
        require!(
            caller == self.owner_id || caller == self.operator_id,
            "NEAR_NOT_OWNER: only operator may deposit verifier balance"
        );
        let qty = amount
            .parse::<i128>()
            .unwrap_or_else(|_| env::panic_str("NEAR_INTENT_INVALID_AMOUNT: invalid amount"));
        require!(qty > 0, "NEAR_INTENT_INVALID_AMOUNT: amount must be > 0");
        let k = bal_key(&account_id, &token_id);
        let next = self.balances.get(&k).copied().unwrap_or(0).saturating_add(qty);
        self.balances.insert(k, next);
        next.to_string()
    }

    pub fn balance_of(&self, account_id: String, token_id: String) -> String {
        self.balances
            .get(&bal_key(&account_id, &token_id))
            .copied()
            .unwrap_or(0)
            .to_string()
    }

    pub fn simulate_intents(&self, intents: Vec<SignedTokenDiffIntent>) -> SimulationView {
        match self.validate_batch(&intents, env::block_timestamp_ms()) {
            Ok(_) => SimulationView {
                ok: true,
                error_code: None,
                intent_count: intents.len() as u32,
            },
            Err(code) => SimulationView {
                ok: false,
                error_code: Some(code.to_string()),
                intent_count: intents.len() as u32,
            },
        }
    }

    pub fn execute_intents(
        &mut self,
        op_id: String,
        intents: Vec<SignedTokenDiffIntent>,
    ) -> ExecutionReceiptView {
        require!(!op_id.is_empty(), "NEAR_INTENT_INVALID: op_id required");
        if let Some(prev) = self.processed_ops.get(&op_id) {
            return prev.clone();
        }
        let (tokens, all_keys_onchain) = self
            .validate_batch(&intents, env::block_timestamp_ms())
            .unwrap_or_else(|err| env::panic_str(err));
        if !all_keys_onchain {
            let caller = env::predecessor_account_id();
            require!(
                caller == self.owner_id || caller == self.operator_id,
                "NEAR_NOT_OWNER: unregistered account intents require operator submission"
            );
        }

        let mut seen_nonces = BTreeSet::new();
        for intent in &intents {
            let nk = nonce_key(&intent.diff.account_id, &intent.nonce);
            require!(
                seen_nonces.insert(nk.clone()),
                "NEAR_INTENT_NONCE_REUSED: duplicate nonce in batch"
            );
            self.used_nonces.insert(nk, true);

            for (tok, raw_delta) in &intent.diff.deltas {
                let delta = raw_delta
                    .parse::<i128>()
                    .unwrap_or_else(|_| env::panic_str("NEAR_INTENT_INVALID_AMOUNT"));
                let bk = bal_key(&intent.diff.account_id, tok);
                let cur = self.balances.get(&bk).copied().unwrap_or(0);
                let next = cur.checked_add(delta).unwrap_or_else(|| env::panic_str("ERR_OVERFLOW"));
                if self.strict_balances {
                    require!(
                        next >= 0,
                        "NEAR_INSUFFICIENT_FUNDS: verifier balance insufficient"
                    );
                }
                self.balances.insert(bk, next);
            }
        }

        let receipt = ExecutionReceiptView {
            op_id: op_id.clone(),
            settled_intents: intents.len() as u32,
            tokens: tokens.into_iter().collect(),
        };
        self.processed_ops.insert(op_id.clone(), receipt.clone());
        env::log_str(&format!(
            "EVENT_JSON:{}",
            json!({
                "standard": "terra-intents",
                "version": "1.0.0",
                "event": "execute_intents",
                "data": [{ "op_id": op_id, "settled_intents": receipt.settled_intents, "tokens": receipt.tokens }],
            })
        ));
        receipt
    }

    fn insert_account_key(&mut self, account_id: &str, public_key: &str) {
        require!(
            !account_id.is_empty() && decode_ed25519_32(public_key).is_ok(),
            "NEAR_INTENT_BAD_SIGNATURE: invalid ed25519 public key"
        );
        let reg_key = key_reg_key(account_id, public_key);
        let already = self.public_keys.get(&reg_key).copied().unwrap_or(false);
        if !already {
            self.public_keys.insert(reg_key, true);
            let next = self
                .account_key_counts
                .get(account_id)
                .copied()
                .unwrap_or(0)
                .saturating_add(1);
            self.account_key_counts.insert(account_id.to_string(), next);
        }
    }

    fn verify_key_binding(
        &self,
        account_id: &str,
        public_key: &str,
        pub32: &[u8; 32],
    ) -> Result<bool, &'static str> {
        if self
            .public_keys
            .get(&key_reg_key(account_id, public_key))
            .copied()
            .unwrap_or(false)
        {
            return Ok(true);
        }
        if is_implicit_hex_account(account_id) {
            return if hex_encode_32(pub32) == account_id {
                Ok(true)
            } else {
                Err("NEAR_INTENT_KEY_MISMATCH")
            };
        }
        let registered_count = self
            .account_key_counts
            .get(account_id)
            .copied()
            .unwrap_or(0);
        if registered_count > 0 {
            return Err("NEAR_INTENT_UNREGISTERED_KEY");
        }
        Ok(false)
    }

    fn validate_batch(
        &self,
        intents: &[SignedTokenDiffIntent],
        now_ms: u64,
    ) -> Result<(BTreeSet<String>, bool), &'static str> {
        if intents.is_empty() {
            return Err("NEAR_INTENT_EMPTY");
        }
        let mut totals: BTreeMap<String, i128> = BTreeMap::new();
        let mut batch_nonces = BTreeSet::new();
        let mut all_keys_onchain = true;
        for intent in intents {
            if intent.deadline_ms < now_ms {
                return Err("NEAR_INTENT_EXPIRED");
            }
            let nk = nonce_key(&intent.diff.account_id, &intent.nonce);
            if self.used_nonces.get(&nk).copied().unwrap_or(false) || !batch_nonces.insert(nk) {
                return Err("NEAR_INTENT_NONCE_REUSED");
            }
            let nonce_vec = decode_base64(&intent.nonce).map_err(|_| "NEAR_INTENT_INVALID_NONCE")?;
            let nonce32: [u8; 32] = nonce_vec
                .try_into()
                .map_err(|_| "NEAR_INTENT_INVALID_NONCE")?;
            let pub32 = decode_ed25519_32(&intent.public_key)?;
            let key_onchain =
                self.verify_key_binding(&intent.diff.account_id, &intent.public_key, &pub32)?;
            if !key_onchain {
                all_keys_onchain = false;
            }
            let sig64 = decode_ed25519_64(&intent.signature)?;
            let hash = nep413_hash(intent, &nonce32);
            if !env::ed25519_verify(&sig64, &hash, &pub32) {
                return Err("NEAR_INTENT_BAD_SIGNATURE");
            }
            if intent.diff.deltas.is_empty() {
                return Err("NEAR_INTENT_EMPTY_DIFF");
            }
            for (tok, raw_delta) in &intent.diff.deltas {
                let d = raw_delta
                    .parse::<i128>()
                    .map_err(|_| "NEAR_INTENT_INVALID_AMOUNT")?;
                let entry = totals.entry(tok.clone()).or_insert(0);
                *entry = entry.checked_add(d).ok_or("NEAR_INTENT_OVERFLOW")?;
            }
        }
        for (_, sum) in &totals {
            if *sum != 0 {
                return Err("NEAR_INTENT_NOT_ZERO_SUM");
            }
        }
        Ok((totals.into_keys().collect(), all_keys_onchain))
    }
}

#[cfg(test)]
mod tests;
