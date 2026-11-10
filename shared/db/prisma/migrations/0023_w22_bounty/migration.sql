-- W22-19 bounty mirror (DATA_MODEL `chain.bounty`, NEAR-110). Expiry is the bounty row, not escrow (BE-73).

CREATE TABLE "chain"."bounty" (
    "id" VARCHAR(80) NOT NULL,
    "planet_id" VARCHAR(64) NOT NULL,
    "poster_colony_id" VARCHAR(64) NOT NULL,
    "colony_index" INTEGER NOT NULL,
    "account_id" VARCHAR(64) NOT NULL,
    "target" JSONB NOT NULL,
    "reward" JSONB NOT NULL,
    "escrow_id" VARCHAR(64) NOT NULL,
    "escrow_tx" VARCHAR(128) NOT NULL,
    "op_id" VARCHAR(200) NOT NULL,
    "claimer_account_id" VARCHAR(64),
    "state" VARCHAR(16) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bounty_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bounty_op_id_key" ON "chain"."bounty"("op_id");
CREATE INDEX "bounty_planet_id_state_idx" ON "chain"."bounty"("planet_id", "state");
CREATE INDEX "bounty_poster_colony_id_state_idx" ON "chain"."bounty"("poster_colony_id", "state");
