-- Historical notifications predate stable business-event identities. Keep the
-- new column nullable so those rows remain unchanged and valid.
ALTER TABLE "notification" ADD COLUMN "event_key" VARCHAR(255);

-- PostgreSQL permits multiple NULL values in this unique index, preserving
-- legacy rows while enforcing one notification per logical event and recipient
-- for every new notification that supplies an event key.
CREATE UNIQUE INDEX "uq_notification_hotel_user_event"
ON "notification"("hotel_id", "user_id", "event_key");
