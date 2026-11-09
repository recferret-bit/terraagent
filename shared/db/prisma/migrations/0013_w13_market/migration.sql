-- CreateTable
CREATE TABLE "chain"."market_order" (
    "id" BIGSERIAL NOT NULL,
    "order_id" VARCHAR(64) NOT NULL,
    "ref" VARCHAR(160) NOT NULL,
    "planet_id" VARCHAR(64) NOT NULL,
    "pair" VARCHAR(48) NOT NULL,
    "base" VARCHAR(32) NOT NULL,
    "quote" VARCHAR(32) NOT NULL,
    "side" VARCHAR(4) NOT NULL,
    "colony_id" VARCHAR(64) NOT NULL,
    "colony_index" INTEGER,
    "player_id" VARCHAR(64),
    "account_id" VARCHAR(64) NOT NULL,
    "stall_colony_id" VARCHAR(64) NOT NULL,
    "stall_account_id" VARCHAR(64) NOT NULL,
    "stall_hub_entity_id" INTEGER,
    "platform_account_id" VARCHAR(64) NOT NULL,
    "amount" DECIMAL(78,0) NOT NULL,
    "filled" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "price_amount" DECIMAL(78,0) NOT NULL,
    "fill_policy" VARCHAR(16) NOT NULL,
    "policy_version" VARCHAR(64) NOT NULL,
    "policy_hash" VARCHAR(80) NOT NULL,
    "platform_fee_bp" INTEGER NOT NULL,
    "stall_fee_bp" INTEGER NOT NULL,
    "max_stall_fee_bp" INTEGER,
    "reserved_principal" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "reserved_fees" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "cum_notional" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "fee_buckets" JSONB NOT NULL DEFAULT '{}',
    "actor_kind" VARCHAR(16) NOT NULL DEFAULT 'player',
    "state" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "signed_terms" JSONB,
    "ttl_s" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_error" VARCHAR(400),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chain"."intent_trade" (
    "id" BIGSERIAL NOT NULL,
    "trade_id" VARCHAR(64) NOT NULL,
    "planet_id" VARCHAR(64) NOT NULL,
    "pair" VARCHAR(48) NOT NULL,
    "base" VARCHAR(32) NOT NULL,
    "quote" VARCHAR(32) NOT NULL,
    "maker_order_id" VARCHAR(64) NOT NULL,
    "taker_order_id" VARCHAR(64) NOT NULL,
    "maker_side" VARCHAR(4) NOT NULL,
    "buyer_colony_id" VARCHAR(64) NOT NULL,
    "seller_colony_id" VARCHAR(64) NOT NULL,
    "buyer_account_id" VARCHAR(64) NOT NULL,
    "seller_account_id" VARCHAR(64) NOT NULL,
    "stall_colony_id" VARCHAR(64) NOT NULL,
    "stall_account_id" VARCHAR(64) NOT NULL,
    "platform_account_id" VARCHAR(64) NOT NULL,
    "treasury_account_id" VARCHAR(64),
    "amount" DECIMAL(78,0) NOT NULL,
    "notional" DECIMAL(78,0) NOT NULL,
    "platform_fee" DECIMAL(78,0) NOT NULL,
    "stall_fee" DECIMAL(78,0) NOT NULL,
    "treasury_allocation" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "platform_fee_bp" INTEGER NOT NULL,
    "stall_fee_bp" INTEGER NOT NULL,
    "policy_version" VARCHAR(64) NOT NULL,
    "policy_hash" VARCHAR(80) NOT NULL,
    "legs" JSONB NOT NULL,
    "batch_hash" VARCHAR(80) NOT NULL,
    "buyer_actor_kind" VARCHAR(16) NOT NULL DEFAULT 'player',
    "seller_actor_kind" VARCHAR(16) NOT NULL DEFAULT 'player',
    "organic" BOOLEAN NOT NULL DEFAULT true,
    "state" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "tx_hash" VARCHAR(96),
    "last_error" VARCHAR(400),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMPTZ(3),

    CONSTRAINT "intent_trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chain"."market_stall" (
    "planet_id" VARCHAR(64) NOT NULL,
    "colony_id" VARCHAR(64) NOT NULL,
    "colony_index" INTEGER,
    "hub_entity_id" INTEGER,
    "account_id" VARCHAR(64),
    "name" VARCHAR(64),
    "fee_bp" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_stall_pkey" PRIMARY KEY ("planet_id","colony_id")
);

-- CreateTable
CREATE TABLE "chain"."mock_chain_intents_balance" (
    "account_id" VARCHAR(64) NOT NULL,
    "token_id" VARCHAR(96) NOT NULL,
    "amount" DECIMAL(78,0) NOT NULL DEFAULT 0,

    CONSTRAINT "mock_chain_intents_balance_pkey" PRIMARY KEY ("account_id","token_id")
);

-- CreateTable
CREATE TABLE "chain"."mock_chain_intent_nonce" (
    "signer" VARCHAR(64) NOT NULL,
    "nonce" VARCHAR(96) NOT NULL,
    "op_id" VARCHAR(200),
    "used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mock_chain_intent_nonce_pkey" PRIMARY KEY ("signer","nonce")
);

-- CreateIndex
CREATE UNIQUE INDEX "market_order_order_id_key" ON "chain"."market_order"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "market_order_ref_key" ON "chain"."market_order"("ref");

-- CreateIndex
CREATE INDEX "market_order_planet_id_pair_state_idx" ON "chain"."market_order"("planet_id", "pair", "state");

-- CreateIndex
CREATE INDEX "market_order_colony_id_state_idx" ON "chain"."market_order"("colony_id", "state");

-- CreateIndex
CREATE INDEX "market_order_state_expires_at_idx" ON "chain"."market_order"("state", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "intent_trade_trade_id_key" ON "chain"."intent_trade"("trade_id");

-- CreateIndex
CREATE INDEX "intent_trade_planet_id_pair_state_settled_at_idx" ON "chain"."intent_trade"("planet_id", "pair", "state", "settled_at");

-- CreateIndex
CREATE INDEX "intent_trade_buyer_colony_id_created_at_idx" ON "chain"."intent_trade"("buyer_colony_id", "created_at");

-- CreateIndex
CREATE INDEX "intent_trade_seller_colony_id_created_at_idx" ON "chain"."intent_trade"("seller_colony_id", "created_at");

-- CreateIndex
CREATE INDEX "intent_trade_stall_colony_id_state_idx" ON "chain"."intent_trade"("stall_colony_id", "state");
