-- AlterTable
ALTER TABLE "core"."player" ADD COLUMN IF NOT EXISTS "near_ai_api_key" TEXT,
ADD COLUMN IF NOT EXISTS "near_ai_model" VARCHAR(128);
