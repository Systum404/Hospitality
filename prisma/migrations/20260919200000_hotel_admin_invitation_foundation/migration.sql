CREATE TYPE "admin_invitation_status" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'SUPERSEDED');

ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

CREATE TABLE "admin_invitation" (
  "id" UUID NOT NULL,
  "hotel_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "user_role_id" UUID NOT NULL,
  "email_snapshot" VARCHAR(255) NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "status" "admin_invitation_status" NOT NULL DEFAULT 'PENDING',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "accepted_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "superseded_at" TIMESTAMPTZ(6),
  CONSTRAINT "admin_invitation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "admin_invitation_token_hash_format" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "admin_invitation_email_normalized" CHECK ("email_snapshot" = lower("email_snapshot")),
  CONSTRAINT "admin_invitation_expiry_after_creation" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "admin_invitation_lifecycle_timestamps" CHECK (
    ("status" = 'PENDING' AND "accepted_at" IS NULL AND "revoked_at" IS NULL AND "superseded_at" IS NULL)
    OR ("status" = 'ACCEPTED' AND "accepted_at" IS NOT NULL AND "revoked_at" IS NULL AND "superseded_at" IS NULL)
    OR ("status" = 'REVOKED' AND "accepted_at" IS NULL AND "revoked_at" IS NOT NULL AND "superseded_at" IS NULL)
    OR ("status" = 'SUPERSEDED' AND "accepted_at" IS NULL AND "revoked_at" IS NULL AND "superseded_at" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "uq_admin_invitation_token_hash" ON "admin_invitation"("token_hash");
CREATE UNIQUE INDEX "uq_admin_invitation_pending_identity" ON "admin_invitation"("hotel_id", "email_snapshot") WHERE "status" = 'PENDING';
CREATE INDEX "idx_admin_invitation_hotel_created" ON "admin_invitation"("hotel_id", "created_at");
CREATE INDEX "idx_admin_invitation_user" ON "admin_invitation"("user_id");
CREATE INDEX "idx_admin_invitation_user_role" ON "admin_invitation"("user_role_id");
CREATE INDEX "idx_admin_invitation_created_by" ON "admin_invitation"("created_by");

ALTER TABLE "admin_invitation" ADD CONSTRAINT "admin_invitation_hotel_id_fkey"
  FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "admin_invitation" ADD CONSTRAINT "admin_invitation_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "admin_invitation" ADD CONSTRAINT "admin_invitation_user_role_scope_fkey"
  FOREIGN KEY ("user_role_id", "hotel_id", "user_id") REFERENCES "user_role"("id", "hotel_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "admin_invitation" ADD CONSTRAINT "admin_invitation_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
