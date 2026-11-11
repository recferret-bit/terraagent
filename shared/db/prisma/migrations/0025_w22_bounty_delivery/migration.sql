-- CreateTable
CREATE TABLE "chain"."bounty_delivery" (
    "bounty_id" VARCHAR(80) NOT NULL,
    "op_id" VARCHAR(200) NOT NULL,
    "amount" DECIMAL(40,0) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bounty_delivery_pkey" PRIMARY KEY ("bounty_id","op_id")
);
