-- Create users table if it wasn't included in the initial migration
CREATE TABLE IF NOT EXISTS "users" (
  "id"        TEXT         NOT NULL,
  "googleId"  TEXT         NOT NULL,
  "email"     TEXT         NOT NULL,
  "name"      TEXT,
  "avatar"    TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_googleId_key" ON "users"("googleId");
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key"    ON "users"("email");

-- Add owner columns to sessions (IF NOT EXISTS in case a partial run already added them)
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "user_id" TEXT;
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "guest_id" TEXT;

CREATE INDEX IF NOT EXISTS "sessions_user_id_idx"  ON "sessions"("user_id");
CREATE INDEX IF NOT EXISTS "sessions_guest_id_idx" ON "sessions"("guest_id");

-- Foreign key from sessions.user_id -> users.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'sessions_user_id_fkey'
  ) THEN
    ALTER TABLE "sessions"
      ADD CONSTRAINT "sessions_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
