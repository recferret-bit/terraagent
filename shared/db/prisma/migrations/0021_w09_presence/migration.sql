-- AlterTable
ALTER TABLE "core"."colony" ADD COLUMN     "last_seen_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "core"."player" ADD COLUMN     "last_seen_at" TIMESTAMPTZ(3);
