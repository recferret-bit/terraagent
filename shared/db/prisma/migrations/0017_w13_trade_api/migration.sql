-- CreateTable
CREATE TABLE "chain"."trade_api_key" (
    "key_id" VARCHAR(40) NOT NULL,
    "secret_hash" VARCHAR(64) NOT NULL,
    "owner_id" VARCHAR(64) NOT NULL,
    "label" VARCHAR(64) NOT NULL,
    "planet_id" VARCHAR(64) NOT NULL,
    "colony_id" VARCHAR(64) NOT NULL,
    "colony_index" INTEGER NOT NULL,
    "account_id" VARCHAR(64) NOT NULL,
    "scopes" TEXT[],
    "rate_per_second" INTEGER,
    "rate_burst" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "trade_api_key_pkey" PRIMARY KEY ("key_id")
);

-- CreateTable
CREATE TABLE "chain"."trade_api_allowance" (
    "key_id" VARCHAR(40) NOT NULL,
    "max_open_orders" INTEGER NOT NULL,
    "max_order_notional" DECIMAL(78,0) NOT NULL,
    "daily_budget" DECIMAL(78,0) NOT NULL,
    "allowed_pairs" TEXT[],
    "price_band_bp" INTEGER,
    "kill_switch" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_api_allowance_pkey" PRIMARY KEY ("key_id")
);

-- CreateTable
CREATE TABLE "chain"."trade_api_request" (
    "request_id" VARCHAR(40) NOT NULL,
    "owner_ref" VARCHAR(80) NOT NULL,
    "key_id" VARCHAR(40),
    "idem_key" VARCHAR(80) NOT NULL,
    "body_hash" VARCHAR(64) NOT NULL,
    "kind" VARCHAR(8) NOT NULL,
    "planet_id" VARCHAR(64) NOT NULL,
    "colony_id" VARCHAR(64) NOT NULL,
    "colony_index" INTEGER NOT NULL,
    "owner_id" VARCHAR(64) NOT NULL,
    "pair" VARCHAR(48),
    "side" VARCHAR(4),
    "resource" VARCHAR(32),
    "amount" DECIMAL(78,0),
    "price_amount" DECIMAL(78,0),
    "notional" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "state" VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    "command_id" VARCHAR(40),
    "order_id" VARCHAR(64),
    "target_order_id" VARCHAR(64),
    "error_code" VARCHAR(48),
    "error_detail" VARCHAR(400),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_api_request_pkey" PRIMARY KEY ("request_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trade_api_key_secret_hash_key" ON "chain"."trade_api_key"("secret_hash");

-- CreateIndex
CREATE INDEX "trade_api_key_owner_id_idx" ON "chain"."trade_api_key"("owner_id");

-- CreateIndex
CREATE INDEX "trade_api_request_key_id_created_at_idx" ON "chain"."trade_api_request"("key_id", "created_at");

-- CreateIndex
CREATE INDEX "trade_api_request_colony_id_state_idx" ON "chain"."trade_api_request"("colony_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "trade_api_request_owner_ref_idem_key_key" ON "chain"."trade_api_request"("owner_ref", "idem_key");
