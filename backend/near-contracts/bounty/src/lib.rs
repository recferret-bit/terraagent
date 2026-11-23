use near_sdk::store::LookupMap;
use near_sdk::{env, ext_contract, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise};
use serde_json::json;

const CFG_CARGO_KEY: &[u8] = b"cfg:cargo";
const MIN_NEAR_ESCROW_YOCTO: u128 = 5_000_000_000_000_000_000_000; // 0.005 NEAR covers escrow storage lock
const CARGO_PAYOUT_GAS: Gas = Gas::from_tgas(10);

#[allow(dead_code)]
#[ext_contract(ext_cargo)]
trait ExtCargo {
    fn mt_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        amount: String,
        memo: Option<String>,
    );
}

fn nfund_key(escrow_id: &str) -> Vec<u8> {
    format!("nfund:{}", escrow_id).into_bytes()
}

fn cfund_key(escrow_id: &str) -> Vec<u8> {
    format!("cfund:{}", escrow_id).into_bytes()
}

fn is_native_funded(escrow_id: &str) -> bool {
    env::storage_read(&nfund_key(escrow_id)).is_some_and(|b| b == [1])
}

fn set_native_funded(escrow_id: &str) {
    env::storage_write(&nfund_key(escrow_id), &[1]);
}

fn clear_native_funded(escrow_id: &str) {
    env::storage_remove(&nfund_key(escrow_id));
}

fn read_cargo_funded(escrow_id: &str) -> Option<AccountId> {
    env::storage_read(&cfund_key(escrow_id))
        .and_then(|b| String::from_utf8(b).ok())
        .and_then(|s| s.parse::<AccountId>().ok())
}

fn set_cargo_funded(escrow_id: &str, cargo_id: &AccountId) {
    env::storage_write(&cfund_key(escrow_id), cargo_id.as_bytes());
}

fn clear_cargo_funded(escrow_id: &str) {
    env::storage_remove(&cfund_key(escrow_id));
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EscrowRecord {
    pub escrow_id: String,
    pub status: String,
    pub funder: AccountId,
    pub beneficiary: String,
    pub token_id: String,
    pub amount: u128,
    pub expires_at_ms: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EscrowView {
    pub escrow_id: String,
    pub status: String,
    pub funder: AccountId,
    pub beneficiary: String,
    pub token_id: String,
    pub amount: String,
    pub expires_at_ms: u64,
}

impl From<&EscrowRecord> for EscrowView {
    fn from(r: &EscrowRecord) -> Self {
        Self {
            escrow_id: r.escrow_id.clone(),
            status: r.status.clone(),
            funder: r.funder.clone(),
            beneficiary: r.beneficiary.clone(),
            token_id: r.token_id.clone(),
            amount: r.amount.to_string(),
            expires_at_ms: r.expires_at_ms,
        }
    }
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct BountyEscrowContract {
    owner_id: AccountId,
    operator_id: AccountId,
    escrows: LookupMap<String, EscrowRecord>,
    processed_ops: LookupMap<String, String>,
}

fn emit_escrow(event: &str, data: serde_json::Value) {
    let payload = json!({
        "standard": "terra-escrow",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{}", payload));
}

/// Overflow-free `floor(amount * bp / 10_000)` across the full `u128` range.
fn mul_bp_floor(amount: u128, bp: u32) -> u128 {
    let bp_u = bp as u128;
    (amount / 10_000) * bp_u + ((amount % 10_000) * bp_u) / 10_000
}

#[near]
impl BountyEscrowContract {
    #[init]
    pub fn new(owner_id: AccountId, operator_id: AccountId) -> Self {
        Self {
            owner_id,
            operator_id,
            escrows: LookupMap::new(b"e"),
            processed_ops: LookupMap::new(b"o"),
        }
    }

    pub fn set_operator(&mut self, operator_id: AccountId) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "NEAR_NOT_OWNER: only owner can update operator"
        );
        self.operator_id = operator_id;
    }

    pub fn set_cargo_contract(&mut self, cargo_id: AccountId) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "NEAR_NOT_OWNER: only owner can update cargo contract"
        );
        env::storage_write(CFG_CARGO_KEY, cargo_id.as_bytes());
    }

    fn assert_authorized_cargo_contract(&self) {
        let caller = env::predecessor_account_id();
        if let Some(bytes) = env::storage_read(CFG_CARGO_KEY) {
            if let Ok(custom) = String::from_utf8(bytes) {
                let trimmed = custom.trim();
                if !trimmed.is_empty() {
                    require!(
                        caller.as_str() == trimmed,
                        "NEAR_NOT_OWNER: unauthorized NEP-245 cargo contract"
                    );
                    return;
                }
            }
        }
        let owner_res = format!("res.{}", self.owner_id);
        require!(
            caller.as_str() == owner_res,
            "NEAR_NOT_OWNER: unauthorized NEP-245 cargo contract"
        );
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner_id.clone()
    }

    pub fn get_operator(&self) -> AccountId {
        self.operator_id.clone()
    }

    fn require_operator(&self, msg: &'static str) {
        let caller = env::predecessor_account_id();
        require!(caller == self.operator_id || caller == self.owner_id, msg);
    }

    /// Opens a mercenary, peace-treaty, or war-bond escrow (`EscrowPort.open`). Idempotent by `op_id`.
    #[allow(clippy::too_many_arguments)]
    pub fn open_escrow(
        &mut self,
        op_id: String,
        escrow_id: String,
        funder: AccountId,
        beneficiary: String,
        token_id: String,
        amount: String,
        expires_at_ms: u64,
    ) -> EscrowView {
        require!(!op_id.is_empty(), "NEAR_ESCROW_INVALID: op_id required");
        require!(!escrow_id.is_empty(), "NEAR_ESCROW_INVALID: escrow_id required");
        require!(!beneficiary.is_empty(), "NEAR_ESCROW_STATE: beneficiary required");
        require!(!token_id.trim().is_empty(), "NEAR_ESCROW_INVALID: token_id required");
        self.require_operator("NEAR_NOT_OWNER: only operator may open escrows");
        if let Some(existing_id) = self.processed_ops.get(&op_id) {
            if let Some(existing) = self.escrows.get(existing_id) {
                return EscrowView::from(existing);
            }
        }
        let qty = amount
            .parse::<u128>()
            .unwrap_or_else(|_| env::panic_str("NEAR_ESCROW_INVALID: invalid amount"));
        require!(qty > 0, "NEAR_ESCROW_INVALID: amount must be > 0");
        require!(
            self.escrows.get(&escrow_id).is_none(),
            "NEAR_ESCROW_EXISTS: escrow_id already exists"
        );

        let rec = EscrowRecord {
            escrow_id: escrow_id.clone(),
            status: "open".to_string(),
            funder: funder.clone(),
            beneficiary: beneficiary.clone(),
            token_id: token_id.clone(),
            amount: qty,
            expires_at_ms,
        };
        self.escrows.insert(escrow_id.clone(), rec.clone());
        self.processed_ops.insert(op_id.clone(), escrow_id.clone());

        emit_escrow(
            "escrow_open",
            json!({
                "escrow_id": escrow_id,
                "funder": funder,
                "beneficiary": beneficiary,
                "token_id": token_id,
                "amount": qty.to_string(),
                "memo": op_id,
            }),
        );
        EscrowView::from(&rec)
    }

    /// Claims an open escrow for `caller` (`EscrowPort.claim`). Idempotent by `op_id`.
    pub fn claim_escrow(
        &mut self,
        op_id: String,
        escrow_id: String,
        caller: AccountId,
    ) -> EscrowView {
        require!(!op_id.is_empty(), "NEAR_ESCROW_INVALID: op_id required");
        self.require_operator("NEAR_NOT_OWNER: only operator may settle escrow claims");
        if let Some(existing_id) = self.processed_ops.get(&op_id) {
            if let Some(existing) = self.escrows.get(existing_id) {
                return EscrowView::from(existing);
            }
        }
        let mut rec = self
            .escrows
            .get(&escrow_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("NEAR_ESCROW_NOT_FOUND: escrow not found"));
        require!(rec.status == "open", "NEAR_ESCROW_STATE: escrow is not open");

        rec.status = "claimed".to_string();
        self.escrows.insert(escrow_id.clone(), rec.clone());
        self.processed_ops.insert(op_id.clone(), escrow_id.clone());

        if is_native_funded(&escrow_id) && rec.amount > 0 {
            clear_native_funded(&escrow_id);
            let _ = Promise::new(caller.clone()).transfer(NearToken::from_yoctonear(rec.amount));
        } else if let Some(cargo_id) = read_cargo_funded(&escrow_id) {
            clear_cargo_funded(&escrow_id);
            if rec.amount > 0 {
                let _ = ext_cargo::ext(cargo_id)
                    .with_static_gas(CARGO_PAYOUT_GAS)
                    .mt_transfer(caller.clone(), rec.token_id.clone(), rec.amount.to_string(), Some(op_id.clone()));
            }
        }

        emit_escrow(
            "escrow_claim",
            json!({
                "escrow_id": escrow_id,
                "to": caller,
                "amount": rec.amount.to_string(),
                "memo": op_id,
            }),
        );
        EscrowView::from(&rec)
    }

    /// Refunds all or part of an open escrow (`EscrowPort.refund`, W22-28 partial mercenary refund).
    pub fn refund_escrow(
        &mut self,
        op_id: String,
        escrow_id: String,
        _caller: AccountId,
        amount: Option<String>,
    ) -> EscrowView {
        require!(!op_id.is_empty(), "NEAR_ESCROW_INVALID: op_id required");
        self.require_operator("NEAR_NOT_OWNER: only operator may refund escrows");
        if let Some(existing_id) = self.processed_ops.get(&op_id) {
            if let Some(existing) = self.escrows.get(existing_id) {
                return EscrowView::from(existing);
            }
        }
        let mut rec = self
            .escrows
            .get(&escrow_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("NEAR_ESCROW_NOT_FOUND: escrow not found"));
        require!(rec.status == "open", "NEAR_ESCROW_STATE: escrow is not open");

        let requested = match amount {
            None => rec.amount,
            Some(raw) => raw
                .parse::<u128>()
                .unwrap_or_else(|_| env::panic_str("NEAR_ESCROW_INVALID: invalid refund amount")),
        };
        require!(requested > 0, "NEAR_ESCROW_INVALID: refund amount must be > 0");
        require!(
            requested <= rec.amount,
            "NEAR_ESCROW_STATE: refund exceeds remaining hold"
        );

        if requested == rec.amount {
            rec.status = "refunded".to_string();
        } else {
            rec.amount -= requested;
        }
        self.escrows.insert(escrow_id.clone(), rec.clone());
        self.processed_ops.insert(op_id.clone(), escrow_id.clone());

        if is_native_funded(&escrow_id) && requested > 0 {
            if rec.status == "refunded" {
                clear_native_funded(&escrow_id);
            }
            let _ = Promise::new(rec.funder.clone()).transfer(NearToken::from_yoctonear(requested));
        } else if let Some(cargo_id) = read_cargo_funded(&escrow_id) {
            if rec.status == "refunded" {
                clear_cargo_funded(&escrow_id);
            }
            if requested > 0 {
                let _ = ext_cargo::ext(cargo_id)
                    .with_static_gas(CARGO_PAYOUT_GAS)
                    .mt_transfer(rec.funder.clone(), rec.token_id.clone(), requested.to_string(), Some(op_id.clone()));
            }
        }

        emit_escrow(
            "escrow_refund",
            json!({
                "escrow_id": escrow_id,
                "to": rec.funder,
                "refunded": requested.to_string(),
                "status": rec.status,
                "memo": op_id,
            }),
        );
        EscrowView::from(&rec)
    }

    /// Slashes an open diplomacy or war bond escrow (`EscrowPort.slash`):
    /// splits the bond `10_000 - protocol_fee_bp` (`90%`) to `victim_id` and `protocol_fee_bp` (`10%`) to `protocol_id`.
    /// Idempotent by `op_id`.
    pub fn slash_escrow(
        &mut self,
        op_id: String,
        escrow_id: String,
        victim_id: AccountId,
        protocol_id: AccountId,
        protocol_fee_bp: u32,
    ) -> EscrowView {
        require!(!op_id.is_empty(), "NEAR_ESCROW_INVALID: op_id required");
        require!(
            protocol_fee_bp <= 10_000,
            "NEAR_ESCROW_INVALID: protocol_fee_bp must be <= 10_000"
        );
        self.require_operator("NEAR_NOT_OWNER: only operator may slash escrows");
        if let Some(existing_id) = self.processed_ops.get(&op_id) {
            if let Some(existing) = self.escrows.get(existing_id) {
                return EscrowView::from(existing);
            }
        }
        let mut rec = self
            .escrows
            .get(&escrow_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("NEAR_ESCROW_NOT_FOUND: escrow not found"));
        require!(rec.status == "open", "NEAR_ESCROW_STATE: escrow is not open");
        require!(
            victim_id != rec.funder,
            "NEAR_ESCROW_INVALID_VICTIM: victim cannot equal funder"
        );
        require!(
            protocol_fee_bp == 0 || protocol_id != rec.funder,
            "NEAR_ESCROW_INVALID_VICTIM: protocol cannot equal funder"
        );

        let protocol_cut = mul_bp_floor(rec.amount, protocol_fee_bp);
        let victim_cut = rec.amount - protocol_cut;
        rec.status = "slashed".to_string();
        self.escrows.insert(escrow_id.clone(), rec.clone());
        self.processed_ops.insert(op_id.clone(), escrow_id.clone());

        if is_native_funded(&escrow_id) {
            clear_native_funded(&escrow_id);
            if victim_cut > 0 {
                let _ = Promise::new(victim_id.clone()).transfer(NearToken::from_yoctonear(victim_cut));
            }
            if protocol_cut > 0 {
                let _ = Promise::new(protocol_id.clone()).transfer(NearToken::from_yoctonear(protocol_cut));
            }
        } else if let Some(cargo_id) = read_cargo_funded(&escrow_id) {
            clear_cargo_funded(&escrow_id);
            if victim_cut > 0 {
                let _ = ext_cargo::ext(cargo_id.clone())
                    .with_static_gas(CARGO_PAYOUT_GAS)
                    .mt_transfer(victim_id.clone(), rec.token_id.clone(), victim_cut.to_string(), Some(op_id.clone()));
            }
            if protocol_cut > 0 {
                let _ = ext_cargo::ext(cargo_id)
                    .with_static_gas(CARGO_PAYOUT_GAS)
                    .mt_transfer(protocol_id.clone(), rec.token_id.clone(), protocol_cut.to_string(), Some(op_id.clone()));
            }
        }

        emit_escrow(
            "escrow_slash",
            json!({
                "escrow_id": escrow_id,
                "funder": rec.funder,
                "victim_id": victim_id,
                "victim_amount": victim_cut.to_string(),
                "protocol_id": protocol_id,
                "protocol_amount": protocol_cut.to_string(),
                "protocol_fee_bp": protocol_fee_bp,
                "memo": op_id,
            }),
        );
        EscrowView::from(&rec)
    }

    /// Opens a real native-NEAR bonded escrow directly from `env::predecessor_account_id()` using attached deposit.
    #[payable]
    pub fn open_near_escrow(
        &mut self,
        op_id: String,
        escrow_id: String,
        beneficiary: String,
        expires_at_ms: u64,
    ) -> EscrowView {
        require!(!op_id.is_empty(), "NEAR_ESCROW_INVALID: op_id required");
        require!(!escrow_id.is_empty(), "NEAR_ESCROW_INVALID: escrow_id required");
        require!(!beneficiary.is_empty(), "NEAR_ESCROW_STATE: beneficiary required");
        let qty = env::attached_deposit().as_yoctonear();
        if let Some(existing_id) = self.processed_ops.get(&op_id) {
            require!(
                qty == 0,
                "NEAR_ESCROW_DUPLICATE_OP: duplicate op_id with attached NEAR deposit"
            );
            if let Some(existing) = self.escrows.get(existing_id) {
                return EscrowView::from(existing);
            }
        }
        require!(qty > 0, "NEAR_ESCROW_INVALID: attached NEAR deposit must be > 0");
        require!(
            qty >= MIN_NEAR_ESCROW_YOCTO,
            "NEAR_ESCROW_INVALID: attached NEAR deposit must be >= 0.005 NEAR to cover storage"
        );
        require!(
            self.escrows.get(&escrow_id).is_none(),
            "NEAR_ESCROW_EXISTS: escrow_id already exists"
        );
        let funder = env::predecessor_account_id();
        let rec = EscrowRecord {
            escrow_id: escrow_id.clone(),
            status: "open".to_string(),
            funder: funder.clone(),
            beneficiary: beneficiary.clone(),
            token_id: "NEAR".to_string(),
            amount: qty,
            expires_at_ms,
        };
        set_native_funded(&escrow_id);
        self.escrows.insert(escrow_id.clone(), rec.clone());
        self.processed_ops.insert(op_id.clone(), escrow_id.clone());
        emit_escrow(
            "escrow_open",
            json!({
                "escrow_id": escrow_id,
                "funder": funder,
                "beneficiary": beneficiary,
                "token_id": "NEAR",
                "amount": qty.to_string(),
                "native_funded": true,
                "memo": op_id,
            }),
        );
        EscrowView::from(&rec)
    }

    /// Permissionless refund callable by `funder` after `expires_at_ms` elapses.
    pub fn claim_expired_refund(&mut self, escrow_id: String) -> EscrowView {
        let mut rec = self
            .escrows
            .get(&escrow_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("NEAR_ESCROW_NOT_FOUND: escrow not found"));
        require!(rec.status == "open", "NEAR_ESCROW_STATE: escrow is not open");
        require!(rec.expires_at_ms > 0, "NEAR_ESCROW_STATE: escrow has no expiry");
        require!(
            env::block_timestamp_ms() >= rec.expires_at_ms,
            "NEAR_ESCROW_STATE: escrow has not expired yet"
        );
        require!(
            env::predecessor_account_id() == rec.funder,
            "NEAR_NOT_OWNER: only escrow funder may claim expired refund"
        );
        let native_funded = is_native_funded(&escrow_id);
        let cargo_funded = read_cargo_funded(&escrow_id);
        require!(
            native_funded || cargo_funded.is_some(),
            "NEAR_ESCROW_STATE: operator-custodied escrows must be refunded via operator"
        );
        let amount = rec.amount;
        rec.status = "refunded".to_string();
        self.escrows.insert(escrow_id.clone(), rec.clone());
        if native_funded && amount > 0 {
            clear_native_funded(&escrow_id);
            let _ = Promise::new(rec.funder.clone()).transfer(NearToken::from_yoctonear(amount));
        } else if let Some(cargo_id) = cargo_funded {
            clear_cargo_funded(&escrow_id);
            if amount > 0 {
                let _ = ext_cargo::ext(cargo_id).with_static_gas(CARGO_PAYOUT_GAS).mt_transfer(
                    rec.funder.clone(),
                    rec.token_id.clone(),
                    amount.to_string(),
                    Some("expired_self_refund".to_string()),
                );
            }
        }
        emit_escrow(
            "escrow_refund",
            json!({
                "escrow_id": escrow_id,
                "to": rec.funder,
                "refunded": amount.to_string(),
                "status": "refunded",
                "memo": "expired_self_refund",
            }),
        );
        EscrowView::from(&rec)
    }

    /// Atomic NEP-245 `mt_transfer_call` receiver for cargo-backed bounties.
    pub fn mt_on_transfer(
        &mut self,
        sender_id: AccountId,
        _previous_owner_ids: Vec<AccountId>,
        token_ids: Vec<String>,
        amounts: Vec<String>,
        msg: String,
    ) -> Vec<String> {
        self.assert_authorized_cargo_contract();
        require!(
            token_ids.len() == 1 && amounts.len() == 1,
            "NEAR_ESCROW_INVALID: single token transfer expected"
        );
        let parsed: serde_json::Value =
            serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("NEAR_ESCROW_INVALID: invalid msg JSON"));
        let escrow_id = parsed
            .get("escrow_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| env::panic_str("NEAR_ESCROW_INVALID: escrow_id required in msg"))
            .to_string();
        let op_id = parsed
            .get("op_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(&escrow_id)
            .to_string();
        let beneficiary = parsed
            .get("beneficiary")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(&escrow_id)
            .to_string();
        let expires_at_ms = parsed.get("expires_at_ms").and_then(|v| v.as_u64()).unwrap_or(0);
        let qty = amounts[0]
            .parse::<u128>()
            .unwrap_or_else(|_| env::panic_str("NEAR_ESCROW_INVALID: invalid amount"));
        require!(qty > 0, "NEAR_ESCROW_INVALID: amount must be > 0");
        if self.processed_ops.contains_key(&op_id) {
            return vec![qty.to_string()];
        }
        require!(
            self.escrows.get(&escrow_id).is_none(),
            "NEAR_ESCROW_EXISTS: escrow_id already exists"
        );
        let cargo_contract = env::predecessor_account_id();
        let rec = EscrowRecord {
            escrow_id: escrow_id.clone(),
            status: "open".to_string(),
            funder: sender_id,
            beneficiary,
            token_id: token_ids[0].clone(),
            amount: qty,
            expires_at_ms,
        };
        set_cargo_funded(&escrow_id, &cargo_contract);
        self.escrows.insert(escrow_id.clone(), rec);
        self.processed_ops.insert(op_id, escrow_id);
        vec!["0".to_string()]
    }

    pub fn get_escrow(&self, escrow_id: String) -> Option<EscrowView> {
        self.escrows.get(&escrow_id).map(EscrowView::from)
    }
}

#[cfg(test)]
mod tests;
