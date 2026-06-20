-- AlterTable: add owner columns to sessions
ALTER TABLE "sessions" ADD COLUMN "user_id" TEXT;
ALTER TABLE "sessions" ADD COLUMN "guest_id" TEXT;

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");
CREATE INDEX "sessions_guest_id_idx" ON "sessions"("guest_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
