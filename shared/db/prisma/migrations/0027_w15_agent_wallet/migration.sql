-- CreateTable
CREATE TABLE "chain"."mock_chain_agent_key" (
    "account_id" VARCHAR(64) NOT NULL,
    "public_key" VARCHAR(128) NOT NULL,
    "receiver_id" VARCHAR(64) NOT NULL,
    "method_names" JSONB NOT NULL,
    "gas_allowance" DECIMAL(78,0) NOT NULL,
    "gas_spent" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mock_chain_agent_key_pkey" PRIMARY KEY ("account_id","public_key")
);

-- CreateTable
CREATE TABLE "chain"."mock_chain_agent_allowance" (
    "account_id" VARCHAR(64) NOT NULL,
    "public_key" VARCHAR(128) NOT NULL,
    "token" VARCHAR(96) NOT NULL,
    "allowance" DECIMAL(78,0) NOT NULL,
    "reserved" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "spent" DECIMAL(78,0) NOT NULL DEFAULT 0,

    CONSTRAINT "mock_chain_agent_allowance_pkey" PRIMARY KEY ("account_id","public_key","token")
);

-- AddForeignKey
ALTER TABLE "chain"."mock_chain_agent_allowance" ADD CONSTRAINT "mock_chain_agent_allowance_account_id_public_key_fkey" FOREIGN KEY ("account_id", "public_key") REFERENCES "chain"."mock_chain_agent_key"("account_id", "public_key") ON DELETE CASCADE ON UPDATE CASCADE;
