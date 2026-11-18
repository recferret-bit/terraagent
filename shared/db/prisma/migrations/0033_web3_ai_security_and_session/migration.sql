-- AlterTable
ALTER TABLE "chain"."near_colony_account"
  ADD COLUMN IF NOT EXISTS "trading_session_public_key" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "trading_session_encrypted_secret" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "chain"."nep413_used_nonce" (
  "nonce_key" VARCHAR(160) NOT NULL,
  "account_id" VARCHAR(64) NOT NULL,
  "purpose" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "nep413_used_nonce_pkey" PRIMARY KEY ("nonce_key")
);

CREATE INDEX IF NOT EXISTS "nep413_used_nonce_created_at_idx" ON "chain"."nep413_used_nonce"("created_at");

-- CreateTable
CREATE TABLE IF NOT EXISTS "ai"."director_tee_attestation" (
  "id" VARCHAR(80) NOT NULL,
  "colony_id" VARCHAR(64) NOT NULL,
  "planet_id" VARCHAR(64) NOT NULL,
  "chat_id" VARCHAR(128) NOT NULL,
  "model" VARCHAR(128) NOT NULL,
  "request_hash" VARCHAR(128) NOT NULL,
  "response_hash" VARCHAR(128) NOT NULL,
  "signing_algo" VARCHAR(16) NOT NULL,
  "signing_address" VARCHAR(160),
  "signature" TEXT,
  "signature_text" TEXT,
  "signature_kind" VARCHAR(32) NOT NULL,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "crypto_verified" BOOLEAN NOT NULL DEFAULT false,
  "directive_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "director_tee_attestation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "director_tee_attestation_colony_id_created_at_idx" ON "ai"."director_tee_attestation"("colony_id", "created_at");
