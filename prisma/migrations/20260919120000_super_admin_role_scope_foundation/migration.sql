-- Role and assignment scope foundation for the company control plane.
-- This migration intentionally creates only the protected SUPER_ADMIN role;
-- it does not create or promote any user.

CREATE TYPE "role_scope" AS ENUM ('COMPANY', 'HOTEL');
CREATE TYPE "assignment_status" AS ENUM ('PENDING', 'ACTIVE', 'INACTIVE');

ALTER TABLE "role"
  ADD COLUMN "system_key" VARCHAR(50),
  ADD COLUMN "scope" "role_scope",
  ADD COLUMN "is_protected" BOOLEAN NOT NULL DEFAULT true;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "role"
    WHERE "name" NOT IN ('Admin', 'Manager', 'Reception', 'Captain', 'Kitchen')
  ) THEN
    RAISE EXCEPTION 'Unexpected role rows must be reviewed before applying the role scope migration.';
  END IF;
END $$;

UPDATE "role"
SET
  "system_key" = CASE "name"
    WHEN 'Admin' THEN 'HOTEL_ADMIN'
    WHEN 'Manager' THEN 'MANAGER'
    WHEN 'Reception' THEN 'RECEPTION'
    WHEN 'Captain' THEN 'CAPTAIN'
    WHEN 'Kitchen' THEN 'KITCHEN'
  END,
  "scope" = 'HOTEL'::"role_scope";

ALTER TABLE "role"
  ALTER COLUMN "system_key" SET NOT NULL,
  ALTER COLUMN "scope" SET NOT NULL;

CREATE UNIQUE INDEX "role_system_key_key" ON "role"("system_key");
CREATE UNIQUE INDEX "uq_role_id_scope" ON "role"("id", "scope");

INSERT INTO "role" ("name", "system_key", "scope", "is_protected")
VALUES ('Super Admin', 'SUPER_ADMIN', 'COMPANY', true);

ALTER TABLE "user_role"
  ADD COLUMN "role_scope" "role_scope",
  ADD COLUMN "status" "assignment_status" NOT NULL DEFAULT 'ACTIVE';

UPDATE "user_role" AS assignment
SET "role_scope" = role."scope"
FROM "role" AS role
WHERE role."id" = assignment."role_id";

ALTER TABLE "user_role"
  ALTER COLUMN "role_scope" SET NOT NULL,
  ALTER COLUMN "role_scope" SET DEFAULT 'HOTEL';

ALTER TABLE "user_role"
  DROP CONSTRAINT "user_role_role_id_fkey";

ALTER TABLE "user_role"
  ADD CONSTRAINT "user_role_role_id_role_scope_fkey"
  FOREIGN KEY ("role_id", "role_scope")
  REFERENCES "role"("id", "scope")
  ON DELETE RESTRICT
  ON UPDATE NO ACTION;

ALTER TABLE "user_role"
  ADD CONSTRAINT "user_role_scope_hotel_check"
  CHECK (
    ("role_scope" = 'COMPANY' AND "hotel_id" IS NULL)
    OR
    ("role_scope" = 'HOTEL' AND "hotel_id" IS NOT NULL)
  );

CREATE UNIQUE INDEX "uq_user_role_single_context" ON "user_role"("user_id");
