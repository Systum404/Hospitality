-- AlterTable
ALTER TABLE "notification" ADD COLUMN     "hotel_id" UUID;

-- CreateIndex
CREATE INDEX "idx_notification_hotel_user_created" ON "notification"("hotel_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_notification_hotel_user_unread" ON "notification"("hotel_id", "user_id", "is_read");

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
