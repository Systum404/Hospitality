CREATE TYPE "audit_outcome" AS ENUM ('SUCCESS', 'FAILURE');

CREATE TABLE "audit_event" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "actor_assignment_id" UUID,
    "actor_scope" "role_scope",
    "action" VARCHAR(100) NOT NULL,
    "target_type" VARCHAR(100) NOT NULL,
    "target_id" UUID,
    "hotel_id" UUID,
    "outcome" "audit_outcome" NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "request_id" UUID NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "ip_address" INET,
    "user_agent" VARCHAR(512),

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_event_actor_context_check" CHECK (
      ("actor_user_id" IS NULL AND "actor_assignment_id" IS NULL AND "actor_scope" IS NULL)
      OR
      ("actor_user_id" IS NOT NULL AND "actor_assignment_id" IS NOT NULL AND "actor_scope" IS NOT NULL)
    ),
    CONSTRAINT "audit_event_action_nonempty_check" CHECK (length(btrim("action")) > 0),
    CONSTRAINT "audit_event_target_type_nonempty_check" CHECK (length(btrim("target_type")) > 0),
    CONSTRAINT "audit_event_metadata_object_check" CHECK (jsonb_typeof("metadata") = 'object')
);

CREATE INDEX "idx_audit_event_occurred" ON "audit_event"("occurred_at", "id");
CREATE INDEX "idx_audit_event_actor" ON "audit_event"("actor_user_id", "occurred_at");
CREATE INDEX "idx_audit_event_hotel" ON "audit_event"("hotel_id", "occurred_at");
CREATE INDEX "idx_audit_event_action" ON "audit_event"("action", "occurred_at");
CREATE INDEX "idx_audit_event_target" ON "audit_event"("target_type", "target_id");
CREATE INDEX "idx_audit_event_request" ON "audit_event"("request_id");

ALTER TABLE "audit_event"
  ADD CONSTRAINT "audit_event_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "audit_event"
  ADD CONSTRAINT "audit_event_actor_assignment_id_fkey"
  FOREIGN KEY ("actor_assignment_id") REFERENCES "user_role"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "audit_event"
  ADD CONSTRAINT "audit_event_hotel_id_fkey"
  FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE FUNCTION "reject_audit_event_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_EVENT_APPEND_ONLY' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "audit_event_append_only"
BEFORE UPDATE OR DELETE ON "audit_event"
FOR EACH ROW
EXECUTE FUNCTION "reject_audit_event_mutation"();
