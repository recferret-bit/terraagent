CREATE TABLE core.progression_receipt (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL, payload JSONB NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX progression_receipt_player_id_idx ON core.progression_receipt(player_id);
CREATE TABLE core.progression_effect (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, player_id TEXT NOT NULL, payload JSONB NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, available_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ(3), last_error TEXT, lease TEXT
);
CREATE INDEX progression_effect_kind_completed_at_available_at_idx ON core.progression_effect(kind, completed_at, available_at);
