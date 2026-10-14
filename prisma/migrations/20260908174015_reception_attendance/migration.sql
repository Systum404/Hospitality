-- CreateEnum
CREATE TYPE "attendance_status" AS ENUM ('present', 'absent');

-- CreateTable
CREATE TABLE "attendance" (
    "id" UUID NOT NULL,
    "hotel_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "attendance_date" DATE NOT NULL,
    "status" "attendance_status" NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recorded_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_attendance_hotel_date" ON "attendance"("hotel_id", "attendance_date");

-- CreateIndex
CREATE INDEX "idx_attendance_user_id" ON "attendance"("user_id");

-- CreateIndex
CREATE INDEX "idx_attendance_recorded_by" ON "attendance"("recorded_by");

-- CreateIndex
CREATE UNIQUE INDEX "uq_attendance_hotel_user_date" ON "attendance"("hotel_id", "user_id", "attendance_date");

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
