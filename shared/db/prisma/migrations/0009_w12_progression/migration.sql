-- CreateTable
CREATE TABLE "core"."player_fact" (
    "player_id" TEXT NOT NULL,
    "family" VARCHAR(64) NOT NULL,
    "metric" VARCHAR(16) NOT NULL DEFAULT 'counter',
    "value" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_fact_pkey" PRIMARY KEY ("player_id","family")
);

-- CreateTable
CREATE TABLE "core"."achievement_unlock" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "achievement_id" VARCHAR(64) NOT NULL,
    "family" VARCHAR(64) NOT NULL,
    "tier" INTEGER NOT NULL,
    "earned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nft_status" VARCHAR(16) NOT NULL DEFAULT 'none',
    "nft_token_id" VARCHAR(128),
    "nft_tx_hash" VARCHAR(128),

    CONSTRAINT "achievement_unlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."player_xp" (
    "player_id" TEXT NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 0,
    "title" VARCHAR(64) NOT NULL DEFAULT 'Cadet',
    "frame" VARCHAR(64) NOT NULL DEFAULT 'default',
    "unlock_stage" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_xp_pkey" PRIMARY KEY ("player_id")
);

-- CreateTable
CREATE TABLE "core"."xp_ledger" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "source_id" VARCHAR(128) NOT NULL,
    "delta" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xp_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."colony_history" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "colony_id" TEXT NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "planet_id" TEXT NOT NULL,
    "planet_name" VARCHAR(64) NOT NULL,
    "planet_type" VARCHAR(32) NOT NULL,
    "stage_reached" INTEGER NOT NULL DEFAULT 1,
    "outcome" VARCHAR(32) NOT NULL,
    "founded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "colony_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "player_fact_player_id_idx" ON "core"."player_fact"("player_id");

-- CreateIndex
CREATE INDEX "achievement_unlock_player_id_idx" ON "core"."achievement_unlock"("player_id");

-- CreateIndex
CREATE UNIQUE INDEX "achievement_unlock_player_id_achievement_id_key" ON "core"."achievement_unlock"("player_id", "achievement_id");

-- CreateIndex
CREATE INDEX "xp_ledger_player_id_idx" ON "core"."xp_ledger"("player_id");

-- CreateIndex
CREATE UNIQUE INDEX "xp_ledger_player_id_source_source_id_key" ON "core"."xp_ledger"("player_id", "source", "source_id");

-- CreateIndex
CREATE INDEX "colony_history_player_id_idx" ON "core"."colony_history"("player_id");
