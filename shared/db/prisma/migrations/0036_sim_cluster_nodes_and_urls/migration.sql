-- AlterTable
ALTER TABLE "world"."sim_worker_lease" ADD COLUMN     "internal_url" TEXT;

-- CreateTable
CREATE TABLE "world"."sim_worker_node" (
    "worker_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'all',
    "internal_url" TEXT NOT NULL,
    "load_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sim_worker_node_pkey" PRIMARY KEY ("worker_id")
);

-- CreateIndex
CREATE INDEX "sim_worker_node_role_expires_at_idx" ON "world"."sim_worker_node"("role", "expires_at");
