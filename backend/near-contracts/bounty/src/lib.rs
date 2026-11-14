use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, PanicOnDefault};
use serde_json::json;

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

    pub fn get_escrow(&self, escrow_id: String) -> Option<EscrowView> {
        self.escrows.get(&escrow_id).map(EscrowView::from)
    }
}

#[cfg(test)]
mod tests;
