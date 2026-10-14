-- Parent identities may be removed by existing account/hotel lifecycle paths.
-- Permit only PostgreSQL's nested FK SET NULL action while continuing to reject
-- every direct application UPDATE and DELETE against audit history.
ALTER TABLE "audit_event" DROP CONSTRAINT "audit_event_actor_context_check";

CREATE OR REPLACE FUNCTION "reject_audit_event_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND pg_trigger_depth() > 1
     AND NEW.id IS NOT DISTINCT FROM OLD.id
     AND NEW.actor_scope IS NOT DISTINCT FROM OLD.actor_scope
     AND NEW.action IS NOT DISTINCT FROM OLD.action
     AND NEW.target_type IS NOT DISTINCT FROM OLD.target_type
     AND NEW.target_id IS NOT DISTINCT FROM OLD.target_id
     AND NEW.outcome IS NOT DISTINCT FROM OLD.outcome
     AND NEW.occurred_at IS NOT DISTINCT FROM OLD.occurred_at
     AND NEW.request_id IS NOT DISTINCT FROM OLD.request_id
     AND NEW.metadata IS NOT DISTINCT FROM OLD.metadata
     AND NEW.ip_address IS NOT DISTINCT FROM OLD.ip_address
     AND NEW.user_agent IS NOT DISTINCT FROM OLD.user_agent
     AND (NEW.actor_user_id IS NOT DISTINCT FROM OLD.actor_user_id OR NEW.actor_user_id IS NULL)
     AND (NEW.actor_assignment_id IS NOT DISTINCT FROM OLD.actor_assignment_id OR NEW.actor_assignment_id IS NULL)
     AND (NEW.hotel_id IS NOT DISTINCT FROM OLD.hotel_id OR NEW.hotel_id IS NULL)
     AND (
       NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
       OR NEW.actor_assignment_id IS DISTINCT FROM OLD.actor_assignment_id
       OR NEW.hotel_id IS DISTINCT FROM OLD.hotel_id
     )
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'AUDIT_EVENT_APPEND_ONLY' USING ERRCODE = '55000';
END;
$$;
