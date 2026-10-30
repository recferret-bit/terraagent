-- CreateEnum
CREATE TYPE "chain"."outbox_status" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'DEAD');

-- CreateTable
CREATE TABLE "chain"."chain_outbox" (
    "id" BIGSERIAL NOT NULL,
    "op_id" VARCHAR(160) NOT NULL,
    "port" VARCHAR(40) NOT NULL,
    "method" VARCHAR(40) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "chain"."outbox_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ(3),
    "last_error" VARCHAR(400),
    "receipt" JSONB,
    "tx_hash" VARCHAR(96),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chain_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chain_outbox_op_id_key" ON "chain"."chain_outbox"("op_id");

-- CreateIndex
CREATE INDEX "chain_outbox_status_next_attempt_at_idx" ON "chain"."chain_outbox"("status", "next_attempt_at");
