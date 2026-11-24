-- CreateTable
CREATE TABLE "chain"."staking_patron_history" (
    "id" VARCHAR(120) NOT NULL,
    "planet_id" VARCHAR(80) NOT NULL,
    "account_id" VARCHAR(64) NOT NULL,
    "kind" VARCHAR(24) NOT NULL,
    "active_staked" DECIMAL(40,0) NOT NULL DEFAULT 0,
    "previous_account_id" VARCHAR(64),
    "previous_staked" DECIMAL(40,0),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staking_patron_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staking_patron_history_planet_id_created_at_idx" ON "chain"."staking_patron_history"("planet_id", "created_at");

-- CreateIndex
CREATE INDEX "staking_patron_history_account_id_created_at_idx" ON "chain"."staking_patron_history"("account_id", "created_at");
