-- Enforce that every attendance user belongs to the same hotel through a real user-role assignment.
ALTER TABLE "attendance"
ADD COLUMN "user_role_id" UUID NOT NULL;

CREATE INDEX "idx_attendance_user_role_id" ON "attendance"("user_role_id");

CREATE UNIQUE INDEX "uq_user_role_attendance_scope"
ON "user_role"("id", "hotel_id", "user_id");

ALTER TABLE "attendance"
ADD CONSTRAINT "attendance_user_role_id_hotel_id_user_id_fkey"
FOREIGN KEY ("user_role_id", "hotel_id", "user_id")
REFERENCES "user_role"("id", "hotel_id", "user_id")
ON DELETE RESTRICT ON UPDATE NO ACTION;
