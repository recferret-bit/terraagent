use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, PanicOnDefault};
use serde_json::json;

const MAX_OP_ID_BYTES: usize = 128;
const MAX_COLLECTION_BYTES: usize = 64;
const MAX_TOKEN_ID_BYTES: usize = 128;
const MAX_METADATA_BYTES: usize = 32_768;
const MAX_HISTORY_ENTRIES: usize = 5;
const TOKENS_INDEX_KEY: &[u8] = b"idx:tokens";

fn read_all_token_ids() -> Vec<String> {
    env::storage_read(TOKENS_INDEX_KEY)
        .and_then(|bytes| serde_json::from_slice::<Vec<String>>(&bytes).ok())
        .unwrap_or_default()
}

fn append_token_index(token_id: &str) {
    let mut all = read_all_token_ids();
    if !all.iter().any(|t| t == token_id) {
        all.push(token_id.to_string());
        if let Ok(encoded) = serde_json::to_vec(&all) {
            env::storage_write(TOKENS_INDEX_KEY, &encoded);
        }
    }
}

fn cap_history_entries(history: &mut Vec<DeedHistoryEntry>) {
    if history.len() <= MAX_HISTORY_ENTRIES {
        return;
    }
    let genesis = history[0].clone();
    let keep_tail = MAX_HISTORY_ENTRIES - 1;
    let tail_start = history.len().saturating_sub(keep_tail);
    let mut compact = Vec::with_capacity(MAX_HISTORY_ENTRIES);
    compact.push(genesis);
    compact.extend_from_slice(&history[tail_start..]);
    *history = compact;
}

fn extract_media_url(metadata_json: &str, token_id: &str, version: u32) -> String {
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(metadata_json) {
        if let Some(url) = val.get("imageUrl").and_then(|v| v.as_str()) {
            let trimmed = url.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
        if let Some(media) = val.get("media").and_then(|v| v.as_str()) {
            let trimmed = media.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    format!("/v1/deeds/{}/image?v={}", token_id, version)
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeedHistoryEntry {
    pub op_id: String,
    pub metadata_json: String,
    pub at_ms: u64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredDeed {
    pub collection: String,
    pub token_id: String,
    pub owner_account_id: AccountId,
    pub metadata_json: String,
    pub version: u32,
    pub settled: bool,
    pub op_id: String,
    pub minted_at_ms: u64,
    pub updated_at_ms: u64,
    pub history: Vec<DeedHistoryEntry>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Nep177ContractMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub base_uri: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Nep171TokenMetadata {
    pub title: Option<String>,
    pub description: Option<String>,
    pub media: Option<String>,
    pub copies: Option<u64>,
    pub reference: Option<String>,
    pub extra: Option<String>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Nep171Token {
    pub token_id: String,
    pub owner_id: AccountId,
    pub metadata: Nep171TokenMetadata,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct DeedContract {
    owner_id: AccountId,
    operator_id: AccountId,
    deeds: LookupMap<String, StoredDeed>,
    by_owner: LookupMap<AccountId, Vec<String>>,
    processed_ops: LookupMap<String, String>,
}

fn emit_nep171(event: &str, data: serde_json::Value) {
    let payload = json!({
        "standard": "nep171",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{}", payload));
}

#[near]
impl DeedContract {
    #[init]
    pub fn new(owner_id: AccountId, operator_id: AccountId) -> Self {
        Self {
            owner_id,
            operator_id,
            deeds: LookupMap::new(b"d"),
            by_owner: LookupMap::new(b"w"),
            processed_ops: LookupMap::new(b"p"),
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

    pub fn nft_metadata(&self) -> Nep177ContractMetadata {
        Nep177ContractMetadata {
            spec: "nft-1.0.0".to_string(),
            name: "TerraAgent Colony Deeds & Badges".to_string(),
            symbol: "DEED".to_string(),
            icon: None,
            base_uri: Some("https://api.terraagent.fun".to_string()),
            reference: None,
            reference_hash: None,
        }
    }

    /// Mints a dynamic Colony Deed (or Badge) NFT. Idempotent by `op_id`.
    pub fn mint_deed(
        &mut self,
        op_id: String,
        collection: String,
        token_id: String,
        owner_account_id: AccountId,
        metadata_json: String,
        settled: bool,
    ) -> StoredDeed {
        require!(
            !op_id.is_empty() && op_id.len() <= MAX_OP_ID_BYTES,
            "NEAR_NFT_INVALID: op_id required (<= 128 bytes)"
        );
        require!(
            !collection.trim().is_empty() && collection.len() <= MAX_COLLECTION_BYTES,
            "NEAR_NFT_INVALID: collection required (<= 64 bytes)"
        );
        require!(
            !token_id.is_empty() && token_id.len() <= MAX_TOKEN_ID_BYTES,
            "NEAR_NFT_INVALID: token_id required (<= 128 bytes)"
        );
        require!(
            metadata_json.len() <= MAX_METADATA_BYTES,
            "NEAR_NFT_INVALID: metadata_json exceeds 32 KiB"
        );
        let caller = env::predecessor_account_id();
        require!(
            caller == self.operator_id || caller == self.owner_id,
            "NEAR_NOT_OWNER: only operator may mint Colony Deeds"
        );

        if let Some(existing_tid) = self.processed_ops.get(&op_id) {
            if let Some(existing) = self.deeds.get(existing_tid) {
                return existing.clone();
            }
        }
        require!(
            self.deeds.get(&token_id).is_none(),
            "NEAR_NFT_ALREADY_MINTED: token_id already exists"
        );

        let now = env::block_timestamp_ms();
        let entry = DeedHistoryEntry {
            op_id: op_id.clone(),
            metadata_json: metadata_json.clone(),
            at_ms: now,
        };
        let record = StoredDeed {
            collection,
            token_id: token_id.clone(),
            owner_account_id: owner_account_id.clone(),
            metadata_json,
            version: 1,
            settled,
            op_id: op_id.clone(),
            minted_at_ms: now,
            updated_at_ms: now,
            history: vec![entry],
        };
        self.deeds.insert(token_id.clone(), record.clone());
        let mut owned = self.by_owner.get(&owner_account_id).cloned().unwrap_or_default();
        if !owned.contains(&token_id) {
            owned.push(token_id.clone());
        }
        self.by_owner.insert(owner_account_id.clone(), owned);
        self.processed_ops.insert(op_id.clone(), token_id.clone());
        append_token_index(&token_id);

        emit_nep171(
            "nft_mint",
            json!({
                "owner_id": owner_account_id,
                "token_ids": [token_id],
                "memo": op_id,
            }),
        );
        record
    }

    /// Updates dynamic Colony Deed metadata. Enforces monotonic `version` and one-way `settled: true`.
    pub fn update_metadata(
        &mut self,
        op_id: String,
        token_id: String,
        metadata_json: String,
        settled: bool,
        explicit_unsettle: Option<bool>,
    ) -> StoredDeed {
        require!(
            !op_id.is_empty() && op_id.len() <= MAX_OP_ID_BYTES,
            "NEAR_NFT_INVALID: op_id required (<= 128 bytes)"
        );
        require!(
            !token_id.is_empty() && token_id.len() <= MAX_TOKEN_ID_BYTES,
            "NEAR_NFT_INVALID: token_id required (<= 128 bytes)"
        );
        require!(
            metadata_json.len() <= MAX_METADATA_BYTES,
            "NEAR_NFT_INVALID: metadata_json exceeds 32 KiB"
        );
        let caller = env::predecessor_account_id();
        require!(
            caller == self.operator_id || caller == self.owner_id,
            "NEAR_NOT_OWNER: only operator may update Colony Deeds"
        );

        if let Some(existing_tid) = self.processed_ops.get(&op_id) {
            if let Some(existing) = self.deeds.get(existing_tid) {
                return existing.clone();
            }
        }

        let mut deed = self
            .deeds
            .get(&token_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("NEAR_NFT_NOT_FOUND: deed not found"));

        if deed.settled && explicit_unsettle.unwrap_or(false) {
            env::panic_str("NEAR_NFT_INVALID: settled Colony Deed cannot be unsettled");
        }

        let now = env::block_timestamp_ms();
        deed.version = deed.version.saturating_add(1);
        deed.settled = deed.settled || settled;
        deed.metadata_json = metadata_json.clone();
        deed.updated_at_ms = now;
        deed.history.push(DeedHistoryEntry {
            op_id: op_id.clone(),
            metadata_json,
            at_ms: now,
        });
        cap_history_entries(&mut deed.history);
        self.deeds.insert(token_id.clone(), deed.clone());
        self.processed_ops.insert(op_id.clone(), token_id.clone());

        emit_nep171(
            "nft_metadata_update",
            json!({
                "token_ids": [token_id],
                "memo": op_id,
            }),
        );
        deed
    }

    /// Compacts oversized historical deed entries down to `MAX_HISTORY_ENTRIES` (`5`: genesis + latest 4).
    pub fn prune_history(&mut self, token_id: String) -> StoredDeed {
        let caller = env::predecessor_account_id();
        require!(
            caller == self.operator_id || caller == self.owner_id,
            "NEAR_NOT_OWNER: only operator may prune deed history"
        );
        let mut deed = self
            .deeds
            .get(&token_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("NEAR_NFT_NOT_FOUND: deed not found"));
        cap_history_entries(&mut deed.history);
        self.deeds.insert(token_id, deed.clone());
        deed
    }

    /// Soulbound enforcement (D-18): Colony Deeds cannot be transferred.
    #[payable]
    pub fn nft_transfer(&mut self, _receiver_id: AccountId, _token_id: String) {
        env::panic_str("NEAR_NFT_SOULBOUND: Colony Deeds are non-transferable (D-18)");
    }

    pub fn get_deed(&self, token_id: String) -> Option<StoredDeed> {
        self.deeds.get(&token_id).cloned()
    }

    pub fn owner_of(&self, token_id: String) -> Option<AccountId> {
        self.deeds.get(&token_id).map(|d| d.owner_account_id.clone())
    }

    pub fn nft_token(&self, token_id: String) -> Option<Nep171Token> {
        self.deeds.get(&token_id).map(|d| {
            let is_badge = d.collection.trim().eq_ignore_ascii_case("badge");
            let title = if is_badge {
                format!("TerraAgent Achievement Badge {}", d.token_id)
            } else {
                format!("TerraAgent Colony Deed {}", d.token_id)
            };
            let description = if is_badge {
                "TerraAgent Soulbound Achievement Badge".to_string()
            } else if d.settled {
                "Settled Living Planet Colony Deed (Stage 4)".to_string()
            } else {
                "Active TerraAgent Colony Deed".to_string()
            };
            Nep171Token {
                token_id: d.token_id.clone(),
                owner_id: d.owner_account_id.clone(),
                metadata: Nep171TokenMetadata {
                    title: Some(title),
                    description: Some(description),
                    media: Some(extract_media_url(&d.metadata_json, &d.token_id, d.version)),
                    copies: Some(1),
                    reference: Some(format!("/v1/deeds/{}", d.token_id)),
                    extra: Some(d.metadata_json.clone()),
                },
            }
        })
    }

    pub fn nft_total_supply(&self) -> String {
        read_all_token_ids().len().to_string()
    }

    pub fn nft_tokens(&self, from_index: Option<String>, limit: Option<u32>) -> Vec<Nep171Token> {
        let all = read_all_token_ids();
        let start = from_index
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(0);
        let take = limit.unwrap_or(50).min(100) as usize;
        all.into_iter()
            .skip(start)
            .take(take)
            .filter_map(|tid| self.nft_token(tid))
            .collect()
    }

    pub fn nft_supply_for_owner(&self, account_id: AccountId) -> String {
        self.by_owner
            .get(&account_id)
            .map(|list| list.len())
            .unwrap_or(0)
            .to_string()
    }

    pub fn nft_tokens_for_owner(&self, account_id: AccountId) -> Vec<Nep171Token> {
        self.by_owner
            .get(&account_id)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|tid| self.nft_token(tid))
            .collect()
    }

    pub fn nft_tokens_for_owner_page(
        &self,
        account_id: AccountId,
        from_index: Option<String>,
        limit: Option<u32>,
    ) -> Vec<Nep171Token> {
        let start = from_index
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(0);
        let take = limit.unwrap_or(50).min(100) as usize;
        self.by_owner
            .get(&account_id)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .skip(start)
            .take(take)
            .filter_map(|tid| self.nft_token(tid))
            .collect()
    }
}

#[cfg(test)]
mod tests;
