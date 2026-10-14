CREATE TABLE "auth_context_challenge" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "remember" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_context_challenge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_context_challenge_token_hash_key"
    ON "auth_context_challenge"("token_hash");

CREATE INDEX "idx_auth_context_challenge_user_id"
    ON "auth_context_challenge"("user_id");

CREATE INDEX "idx_auth_context_challenge_expires_at"
    ON "auth_context_challenge"("expires_at");

ALTER TABLE "auth_context_challenge"
    ADD CONSTRAINT "auth_context_challenge_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
