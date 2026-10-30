-- CreateTable
CREATE TABLE "chain"."mock_chain_account" (
    "account_id" VARCHAR(64) NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "public_key" VARCHAR(128),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mock_chain_account_pkey" PRIMARY KEY ("account_id")
);

-- CreateTable
CREATE TABLE "chain"."mock_chain_balance" (
    "account_id" VARCHAR(64) NOT NULL,
    "token_id" VARCHAR(64) NOT NULL,
    "amount" DECIMAL(40,0) NOT NULL DEFAULT 0,

    CONSTRAINT "mock_chain_balance_pkey" PRIMARY KEY ("account_id","token_id")
);

-- CreateTable
CREATE TABLE "chain"."mock_chain_nft" (
    "collection" VARCHAR(64) NOT NULL,
    "token_id" VARCHAR(128) NOT NULL,
    "owner_account_id" VARCHAR(64) NOT NULL,
    "metadata" JSONB NOT NULL,
    "op_id" VARCHAR(200) NOT NULL,
    "minted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mock_chain_nft_pkey" PRIMARY KEY ("collection","token_id")
);

-- CreateTable
CREATE TABLE "chain"."mock_chain_nft_meta_history" (
    "id" BIGSERIAL NOT NULL,
    "collection" VARCHAR(64) NOT NULL,
    "token_id" VARCHAR(128) NOT NULL,
    "metadata" JSONB NOT NULL,
    "op_id" VARCHAR(200) NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mock_chain_nft_meta_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chain"."mock_chain_intent" (
    "id" VARCHAR(64) NOT NULL,
    "signer" VARCHAR(64) NOT NULL,
    "diff" JSONB NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "op_id" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mock_chain_intent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chain"."mock_chain_dao" (
    "id" VARCHAR(64) NOT NULL,
    "policy" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mock_chain_dao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chain"."mock_chain_dao_proposal" (
    "dao_id" VARCHAR(64) NOT NULL,
    "id" INTEGER NOT NULL,
    "proposer" VARCHAR(64) NOT NULL,
    "kind" JSONB NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "votes" JSONB NOT NULL,
    "submit_time" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mock_chain_dao_proposal_pkey" PRIMARY KEY ("dao_id","id")
);

-- CreateTable
CREATE TABLE "chain"."mock_chain_escrow" (
    "id" VARCHAR(64) NOT NULL,
    "opener" VARCHAR(64) NOT NULL,
    "beneficiary" VARCHAR(64),
    "token_id" VARCHAR(64) NOT NULL,
    "amount" DECIMAL(40,0) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mock_chain_escrow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chain"."mock_chain_receipt" (
    "tx_hash" VARCHAR(64) NOT NULL,
    "op_id" VARCHAR(200),
    "port" VARCHAR(32) NOT NULL,
    "method" VARCHAR(64) NOT NULL,
    "status" VARCHAR(8) NOT NULL,
    "error_code" VARCHAR(64),
    "payload" JSONB NOT NULL,
    "block_height" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mock_chain_receipt_pkey" PRIMARY KEY ("tx_hash")
);

-- CreateIndex
CREATE UNIQUE INDEX "mock_chain_nft_op_id_key" ON "chain"."mock_chain_nft"("op_id");

-- CreateIndex
CREATE INDEX "mock_chain_nft_owner_account_id_idx" ON "chain"."mock_chain_nft"("owner_account_id");

-- CreateIndex
CREATE INDEX "mock_chain_nft_meta_history_collection_token_id_id_idx" ON "chain"."mock_chain_nft_meta_history"("collection", "token_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "mock_chain_intent_op_id_key" ON "chain"."mock_chain_intent"("op_id");

-- CreateIndex
CREATE UNIQUE INDEX "mock_chain_receipt_op_id_key" ON "chain"."mock_chain_receipt"("op_id");

-- CreateIndex
CREATE INDEX "mock_chain_receipt_block_height_idx" ON "chain"."mock_chain_receipt"("block_height");

-- AddForeignKey
ALTER TABLE "chain"."mock_chain_dao_proposal" ADD CONSTRAINT "mock_chain_dao_proposal_dao_id_fkey" FOREIGN KEY ("dao_id") REFERENCES "chain"."mock_chain_dao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Monotonic mock block height shared by all mock adapters (concurrency-safe, unlike max()+1).
CREATE SEQUENCE "chain"."mock_chain_block_height_seq" START 1000;
