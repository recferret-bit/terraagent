-- CreateTable
CREATE TABLE "chain"."cargo_tx" (
    "id" BIGSERIAL NOT NULL,
    "op_id" VARCHAR(160) NOT NULL,
    "planet_id" VARCHAR(64),
    "colony_id" VARCHAR(64) NOT NULL,
    "colony_index" INTEGER,
    "account_id" VARCHAR(64),
    "direction" VARCHAR(16) NOT NULL,
    "resource" VARCHAR(32) NOT NULL,
    "amount" DECIMAL(40,0) NOT NULL,
    "state" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "tx_hash" VARCHAR(96),
    "sim_ref" VARCHAR(160) NOT NULL,
    "last_error" VARCHAR(400),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cargo_tx_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cargo_tx_op_id_key" ON "chain"."cargo_tx"("op_id");

-- CreateIndex
CREATE INDEX "cargo_tx_colony_id_state_idx" ON "chain"."cargo_tx"("colony_id", "state");

-- CreateIndex
CREATE INDEX "cargo_tx_colony_id_direction_created_at_idx" ON "chain"."cargo_tx"("colony_id", "direction", "created_at");
