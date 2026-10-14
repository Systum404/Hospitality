CREATE TYPE "hotel_plan" AS ENUM ('UNASSIGNED', 'FREE', 'PREMIUM');

ALTER TABLE "hotel"
ADD COLUMN "plan" "hotel_plan" NOT NULL DEFAULT 'UNASSIGNED';

CREATE INDEX "idx_user_role_hotel_role_status"
ON "user_role"("hotel_id", "role_id", "status");
