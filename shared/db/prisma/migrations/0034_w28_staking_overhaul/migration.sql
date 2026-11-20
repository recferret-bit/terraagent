-- AlterTable
ALTER TABLE "chain"."mock_chain_staking" ADD COLUMN     "asset" VARCHAR(16) NOT NULL DEFAULT 'near',
ADD COLUMN     "last_staked_at" TIMESTAMPTZ(3),
ADD COLUMN     "staked_since_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "chain"."staking_position" ADD COLUMN     "asset" VARCHAR(16) NOT NULL DEFAULT 'near',
ADD COLUMN     "last_staked_at" TIMESTAMPTZ(3),
ADD COLUMN     "staked_since_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "chain"."staking_tx" (
    "id" VARCHAR(120) NOT NULL,
    "account_id" VARCHAR(64) NOT NULL,
    "pool_id" VARCHAR(64) NOT NULL,
    "kind" VARCHAR(24) NOT NULL,
    "asset" VARCHAR(16) NOT NULL DEFAULT 'near',
    "amount_yocto" DECIMAL(40,0) NOT NULL,
    "tx_hash" VARCHAR(160) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staking_tx_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chain"."staking_patron_seat" (
    "planet_id" VARCHAR(80) NOT NULL,
    "account_id" VARCHAR(64) NOT NULL,
    "active_staked" DECIMAL(40,0) NOT NULL,
    "since_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staking_patron_seat_pkey" PRIMARY KEY ("planet_id")
);

-- CreateTable
CREATE TABLE "chain"."staking_patron_nomination" (
    "account_id" VARCHAR(64) NOT NULL,
    "planet_id" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staking_patron_nomination_pkey" PRIMARY KEY ("account_id")
);

-- CreateTable
CREATE TABLE "chain"."staking_patron_payout" (
    "id" VARCHAR(120) NOT NULL,
    "planet_id" VARCHAR(80) NOT NULL,
    "account_id" VARCHAR(64) NOT NULL,
    "amount_usdc_atomic" DECIMAL(40,0) NOT NULL,
    "source_trade_id" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staking_patron_payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai"."ai_free_trial" (
    "player_id" VARCHAR(64) NOT NULL,
    "turns_used" INTEGER NOT NULL DEFAULT 0,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_free_trial_pkey" PRIMARY KEY ("player_id")
);

-- CreateTable
CREATE TABLE "ai"."ai_wallet_usage" (
    "wallet_key" VARCHAR(80) NOT NULL,
    "day" VARCHAR(10) NOT NULL,
    "calls_used" INTEGER NOT NULL DEFAULT 0,
    "usd_micros" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_wallet_usage_pkey" PRIMARY KEY ("wallet_key","day")
);

-- CreateIndex
CREATE INDEX "staking_tx_account_id_created_at_idx" ON "chain"."staking_tx"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "staking_patron_seat_account_id_idx" ON "chain"."staking_patron_seat"("account_id");

-- CreateIndex
CREATE INDEX "staking_patron_nomination_planet_id_idx" ON "chain"."staking_patron_nomination"("planet_id");

-- CreateIndex
CREATE INDEX "staking_patron_payout_account_id_created_at_idx" ON "chain"."staking_patron_payout"("account_id", "created_at");
