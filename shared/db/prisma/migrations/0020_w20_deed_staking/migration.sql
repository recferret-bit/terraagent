-- W20 Colony Deed & Staking persistence (DATA_MODEL `chain.deed`, `chain.staking_position`, NEAR §6, §9).

CREATE TABLE "chain"."deed" (
    "colony_id" VARCHAR(64) NOT NULL,
    "planet_id" VARCHAR(64) NOT NULL,
    "player_id" VARCHAR(64),
    "account_id" VARCHAR(64) NOT NULL,
    "token_id" VARCHAR(128) NOT NULL,
    "contract" VARCHAR(64) NOT NULL DEFAULT 'deeds.terraagent.mock',
    "metadata" JSONB NOT NULL,
    "metadata_version" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "settled" BOOLEAN NOT NULL DEFAULT false,
    "chain_state" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "pending_op_id" VARCHAR(200),
    "last_update_tx" VARCHAR(128),
    "last_error" TEXT,
    "last_dispatched_at" TIMESTAMPTZ(3),
    "last_dispatched_sim_ms" BIGINT NOT NULL DEFAULT 0,
    "pending_milestone" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "deed_pkey" PRIMARY KEY ("colony_id")
);

CREATE UNIQUE INDEX "deed_token_id_key" ON "chain"."deed"("token_id");
CREATE INDEX "deed_player_id_idx" ON "chain"."deed"("player_id");
CREATE INDEX "deed_planet_id_idx" ON "chain"."deed"("planet_id");
CREATE INDEX "deed_account_id_idx" ON "chain"."deed"("account_id");

CREATE TABLE "chain"."deed_history" (
    "id" BIGSERIAL NOT NULL,
    "colony_id" VARCHAR(64) NOT NULL,
    "token_id" VARCHAR(128) NOT NULL,
    "version" INTEGER NOT NULL,
    "change" VARCHAR(200) NOT NULL,
    "metadata" JSONB NOT NULL,
    "op_id" VARCHAR(200) NOT NULL,
    "tx_hash" VARCHAR(128),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deed_history_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "deed_history_colony_id_fkey" FOREIGN KEY ("colony_id") REFERENCES "chain"."deed"("colony_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "deed_history_colony_id_version_key" ON "chain"."deed_history"("colony_id", "version");
CREATE INDEX "deed_history_token_id_version_idx" ON "chain"."deed_history"("token_id", "version");

CREATE TABLE "chain"."staking_position" (
    "colony_id" VARCHAR(64) NOT NULL,
    "pool_id" VARCHAR(64) NOT NULL,
    "account_id" VARCHAR(64) NOT NULL,
    "staked_snapshot" DECIMAL(40,0) NOT NULL DEFAULT 0,
    "unbonding_snapshot" DECIMAL(40,0) NOT NULL DEFAULT 0,
    "unbonding_ready_at" TIMESTAMPTZ(3),
    "withdrawable_snapshot" DECIMAL(40,0) NOT NULL DEFAULT 0,
    "rewards_snapshot" DECIMAL(40,0) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staking_position_pkey" PRIMARY KEY ("colony_id", "pool_id")
);

CREATE INDEX "staking_position_account_id_idx" ON "chain"."staking_position"("account_id");

CREATE TABLE "chain"."mock_chain_staking" (
    "account_id" VARCHAR(64) NOT NULL,
    "pool_id" VARCHAR(64) NOT NULL,
    "staked" DECIMAL(40,0) NOT NULL DEFAULT 0,
    "unbonding" DECIMAL(40,0) NOT NULL DEFAULT 0,
    "unbonding_ready_at" TIMESTAMPTZ(3),
    "withdrawable" DECIMAL(40,0) NOT NULL DEFAULT 0,
    "rewards_accrued" DECIMAL(40,0) NOT NULL DEFAULT 0,
    "last_accrued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mock_chain_staking_pkey" PRIMARY KEY ("account_id", "pool_id")
);
