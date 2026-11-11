-- CreateTable
CREATE TABLE "chain"."guild_npc" (
    "id" VARCHAR(32) NOT NULL,
    "account_id" VARCHAR(64) NOT NULL,
    "strategy" JSONB NOT NULL,
    "inventory_cache" JSONB NOT NULL,
    "home_route" JSONB NOT NULL,
    "allocation_id" VARCHAR(96) NOT NULL,
    "quote_budget_atomic" DECIMAL(78,0) NOT NULL,
    "spend_atomic" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "loss_atomic" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "cargo_label" VARCHAR(16) NOT NULL DEFAULT 'fixture',
    "quote_label" VARCHAR(16) NOT NULL DEFAULT 'subsidy',
    "cash_enabled" INTEGER NOT NULL DEFAULT 0,
    "actor_kind" VARCHAR(16) NOT NULL DEFAULT 'npc',
    "public_key" VARCHAR(128) NOT NULL,
    "trade_key_id" VARCHAR(40) NOT NULL,
    "policy_version" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guild_npc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "guild_npc_account_id_key" ON "chain"."guild_npc"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "guild_npc_allocation_id_key" ON "chain"."guild_npc"("allocation_id");

-- CreateIndex
CREATE UNIQUE INDEX "guild_npc_trade_key_id_key" ON "chain"."guild_npc"("trade_key_id");
