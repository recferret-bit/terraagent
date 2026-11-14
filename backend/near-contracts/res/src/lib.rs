use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, PanicOnDefault};
use serde_json::json;

pub(crate) const VALID_TOKENS: [&str; 10] = [
    "metals.t1",
    "metals.t2",
    "metals.t3",
    "minerals.t1",
    "minerals.t2",
    "minerals.t3",
    "bio.water",
    "bio.biomass",
    "bio.t2",
    "bio.t3",
];

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CargoTokenMetadata {
    pub token_id: String,
    pub name: String,
    pub symbol: String,
    pub decimals: u8,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct CargoContract {
    owner_id: AccountId,
    minter_id: AccountId,
    balances: LookupMap<String, u128>,
    supplies: LookupMap<String, u128>,
    processed_ops: LookupMap<String, bool>,
}

fn bal_key(account_id: &AccountId, token_id: &str) -> String {
    format!("{}|{}", account_id, token_id)
}

fn parse_positive_u128(raw: &str) -> u128 {
    let parsed = raw
        .parse::<u128>()
        .unwrap_or_else(|_| env::panic_str("NEAR_NFT_INVALID: invalid NEP-245 cargo amount"));
    require!(parsed > 0, "NEAR_NFT_INVALID: cargo amount must be > 0");
    parsed
}

fn assert_valid_token(token_id: &str) {
    require!(
        VALID_TOKENS.contains(&token_id),
        "NEAR_NFT_INVALID: unknown NEP-245 cargo token_id"
    );
}

fn emit_nep245(event: &str, data: serde_json::Value) {
    let payload = json!({
        "standard": "nep245",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{}", payload));
}

#[near]
impl CargoContract {
    #[init]
    pub fn new(owner_id: AccountId, minter_id: AccountId) -> Self {
        Self {
            owner_id,
            minter_id,
            balances: LookupMap::new(b"b"),
            supplies: LookupMap::new(b"s"),
            processed_ops: LookupMap::new(b"o"),
        }
    }

    pub fn set_minter(&mut self, minter_id: AccountId) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "NEAR_NOT_OWNER: only owner can update minter"
        );
        self.minter_id = minter_id;
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner_id.clone()
    }

    pub fn get_minter(&self) -> AccountId {
        self.minter_id.clone()
    }

    /// Mints NEP-245 cargo base units (18 decimals). Idempotent by `op_id`.
    pub fn mt_mint(
        &mut self,
        op_id: String,
        to: AccountId,
        token_id: String,
        amount: String,
    ) -> bool {
        require!(!op_id.is_empty(), "NEAR_NFT_INVALID: op_id required");
        assert_valid_token(&token_id);
        let qty = parse_positive_u128(&amount);
        let caller = env::predecessor_account_id();
        require!(
            caller == self.minter_id || caller == self.owner_id,
            "NEAR_NOT_OWNER: only minter may mint cargo"
        );
        if self.processed_ops.get(&op_id).copied().unwrap_or(false) {
            return false;
        }
        let key = bal_key(&to, &token_id);
        let cur = self.balances.get(&key).copied().unwrap_or(0);
        let next = cur
            .checked_add(qty)
            .unwrap_or_else(|| env::panic_str("ERR_BALANCE_OVERFLOW"));
        let sup = self.supplies.get(&token_id).copied().unwrap_or(0);
        let next_sup = sup
            .checked_add(qty)
            .unwrap_or_else(|| env::panic_str("ERR_SUPPLY_OVERFLOW"));
        self.balances.insert(key, next);
        self.supplies.insert(token_id.clone(), next_sup);
        self.processed_ops.insert(op_id.clone(), true);

        emit_nep245(
            "mt_mint",
            json!({
                "owner_id": to,
                "token_ids": [token_id],
                "amounts": [qty.to_string()],
                "memo": op_id,
            }),
        );
        true
    }

    /// Burns NEP-245 cargo base units. Idempotent by `op_id`.
    pub fn mt_burn(
        &mut self,
        op_id: String,
        from: AccountId,
        token_id: String,
        amount: String,
    ) -> bool {
        require!(!op_id.is_empty(), "NEAR_NFT_INVALID: op_id required");
        assert_valid_token(&token_id);
        let qty = parse_positive_u128(&amount);
        let caller = env::predecessor_account_id();
        require!(
            caller == self.minter_id || caller == self.owner_id || caller == from,
            "NEAR_NOT_OWNER: only minter or holder may burn cargo"
        );
        if self.processed_ops.get(&op_id).copied().unwrap_or(false) {
            return false;
        }
        let key = bal_key(&from, &token_id);
        let cur = self.balances.get(&key).copied().unwrap_or(0);
        require!(cur >= qty, "NEAR_INSUFFICIENT_FUNDS: insufficient cargo balance");
        let sup = self.supplies.get(&token_id).copied().unwrap_or(0);
        self.balances.insert(key, cur - qty);
        self.supplies.insert(token_id.clone(), sup.saturating_sub(qty));
        self.processed_ops.insert(op_id.clone(), true);

        emit_nep245(
            "mt_burn",
            json!({
                "owner_id": from,
                "authorized_id": caller,
                "token_ids": [token_id],
                "amounts": [qty.to_string()],
                "memo": op_id,
            }),
        );
        true
    }

    /// Operator or holder transfer with `op_id` idempotency (`CargoTokenPort.transfer`).
    pub fn operator_transfer(
        &mut self,
        op_id: String,
        from: AccountId,
        to: AccountId,
        token_id: String,
        amount: String,
    ) -> bool {
        require!(!op_id.is_empty(), "NEAR_NFT_INVALID: op_id required");
        assert_valid_token(&token_id);
        let qty = parse_positive_u128(&amount);
        let caller = env::predecessor_account_id();
        require!(
            caller == from || caller == self.minter_id || caller == self.owner_id,
            "NEAR_NOT_OWNER: caller not authorized to transfer"
        );
        if self.processed_ops.get(&op_id).copied().unwrap_or(false) {
            return false;
        }
        self.move_tokens(&from, &to, &token_id, qty, Some(op_id.clone()));
        self.processed_ops.insert(op_id, true);
        true
    }

    /// Standard NEP-245 single-token transfer signed by holder (`mt_transfer`).
    /// Accepts `0 yoctoNEAR` (scoped `AgentWallet` FunctionCall keys) or `1 yoctoNEAR` (NEP-245 wallet confirmation),
    /// while rejecting > 1 yoctoNEAR so accidental native deposits are never locked inside the contract.
    #[payable]
    pub fn mt_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        amount: String,
        memo: Option<String>,
    ) {
        require!(
            env::attached_deposit().as_yoctonear() <= 1,
            "NEAR_NFT_INVALID: mt_transfer accepts at most 1 yoctoNEAR"
        );
        require!(
            memo.as_ref().is_none_or(|m| m.len() <= 512),
            "NEAR_NFT_INVALID: memo exceeds 512 bytes"
        );
        assert_valid_token(&token_id);
        let qty = parse_positive_u128(&amount);
        let sender = env::predecessor_account_id();
        self.move_tokens(&sender, &receiver_id, &token_id, qty, memo);
    }

    #[payable]
    pub fn storage_deposit(&mut self, _account_id: Option<AccountId>) -> bool {
        true
    }

    pub fn mt_balance_of(&self, account_id: AccountId, token_id: String) -> String {
        assert_valid_token(&token_id);
        let key = bal_key(&account_id, &token_id);
        self.balances.get(&key).copied().unwrap_or(0).to_string()
    }

    pub fn mt_batch_balance_of(
        &self,
        account_id: AccountId,
        token_ids: Vec<String>,
    ) -> Vec<String> {
        token_ids
            .into_iter()
            .map(|tid| self.mt_balance_of(account_id.clone(), tid))
            .collect()
    }

    pub fn mt_total_supply(&self, token_id: String) -> String {
        assert_valid_token(&token_id);
        self.supplies.get(&token_id).copied().unwrap_or(0).to_string()
    }

    pub fn mt_metadata(&self) -> Vec<CargoTokenMetadata> {
        [
            ("metals.t1", "Refined Metals T1", "MET1"),
            ("metals.t2", "Conductive Alloys T2", "MET2"),
            ("metals.t3", "Superconductors T3", "MET3"),
            ("minerals.t1", "Silicate Minerals T1", "MIN1"),
            ("minerals.t2", "Rare Crystals T2", "MIN2"),
            ("minerals.t3", "Quantum Lattices T3", "MIN3"),
            ("bio.water", "Purified Water", "H2O"),
            ("bio.biomass", "Living Biomass", "BIO1"),
            ("bio.t2", "Bio-Polymers T2", "BIO2"),
            ("bio.t3", "Neural Cultures T3", "BIO3"),
        ]
        .into_iter()
        .map(|(id, name, symbol)| CargoTokenMetadata {
            token_id: id.to_string(),
            name: name.to_string(),
            symbol: symbol.to_string(),
            decimals: 18,
        })
        .collect()
    }

    fn move_tokens(
        &mut self,
        from: &AccountId,
        to: &AccountId,
        token_id: &str,
        qty: u128,
        memo: Option<String>,
    ) {
        let from_key = bal_key(from, token_id);
        let cur_from = self.balances.get(&from_key).copied().unwrap_or(0);
        require!(
            cur_from >= qty,
            "NEAR_INSUFFICIENT_FUNDS: insufficient cargo balance"
        );
        self.balances.insert(from_key, cur_from - qty);

        let to_key = bal_key(to, token_id);
        let cur_to = self.balances.get(&to_key).copied().unwrap_or(0);
        let next_to = cur_to
            .checked_add(qty)
            .unwrap_or_else(|| env::panic_str("ERR_BALANCE_OVERFLOW"));
        self.balances.insert(to_key, next_to);

        emit_nep245(
            "mt_transfer",
            json!({
                "old_owner_id": from,
                "new_owner_id": to,
                "token_ids": [token_id],
                "amounts": [qty.to_string()],
                "memo": memo,
            }),
        );
    }
}

#[cfg(test)]
mod tests;
