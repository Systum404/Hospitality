ALTER TABLE "users"
    ADD COLUMN "credential_version" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "password_change_required" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "auth_context_challenge"
    ADD COLUMN "credential_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "user_role"
    ADD COLUMN "restore_on_identity_reactivation" BOOLEAN NOT NULL DEFAULT false;

UPDATE "user_role" ur
SET "status" = 'INACTIVE'::assignment_status,
    "restore_on_identity_reactivation" = true
FROM "users" u, "role" r
WHERE ur."user_id" = u."id"
  AND ur."role_id" = r."id"
  AND ur."role_scope" = r."scope"
  AND u."is_active" = false
  AND ur."status" = 'ACTIVE'::assignment_status
  AND ur."role_scope" = 'HOTEL'::role_scope
  AND r."system_key" = 'HOTEL_ADMIN';

CREATE TABLE "password_change_challenge" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "credential_version" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "password_change_challenge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "password_change_challenge_user_id_key"
    ON "password_change_challenge"("user_id");

CREATE UNIQUE INDEX "password_change_challenge_token_hash_key"
    ON "password_change_challenge"("token_hash");

CREATE INDEX "idx_password_change_challenge_expires_at"
    ON "password_change_challenge"("expires_at");

ALTER TABLE "password_change_challenge"
    ADD CONSTRAINT "password_change_challenge_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
