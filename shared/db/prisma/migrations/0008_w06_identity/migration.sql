-- CreateTable
CREATE TABLE "core"."social_identity" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "subject" VARCHAR(128) NOT NULL,
    "account_id" VARCHAR(64) NOT NULL,
    "email" VARCHAR(254),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_identity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chain"."near_colony_account" (
    "account_id" VARCHAR(64) NOT NULL,
    "player_id" TEXT NOT NULL,
    "slot" VARCHAR(64) NOT NULL,
    "colony_id" TEXT,
    "owner_account_id" VARCHAR(64) NOT NULL,
    "public_key" VARCHAR(128) NOT NULL,
    "encrypted_secret" TEXT NOT NULL,
    "kek_version" INTEGER NOT NULL,
    "access_key_nonce" BIGINT NOT NULL DEFAULT 1,
    "claimed_at" TIMESTAMPTZ(3),
    "claimed_by_account_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "near_colony_account_pkey" PRIMARY KEY ("account_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "social_identity_account_id_key" ON "core"."social_identity"("account_id");

-- CreateIndex
CREATE INDEX "social_identity_player_id_idx" ON "core"."social_identity"("player_id");

-- CreateIndex
CREATE UNIQUE INDEX "social_identity_provider_subject_key" ON "core"."social_identity"("provider", "subject");

-- CreateIndex
CREATE INDEX "near_colony_account_colony_id_idx" ON "chain"."near_colony_account"("colony_id");

-- CreateIndex
CREATE UNIQUE INDEX "near_colony_account_player_id_slot_key" ON "chain"."near_colony_account"("player_id", "slot");
