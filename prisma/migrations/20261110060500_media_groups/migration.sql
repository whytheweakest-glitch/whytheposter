-- AlterTable
ALTER TABLE "materials" ADD COLUMN "telegram_media_group_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "materials_telegram_media_group_id_key" ON "materials"("telegram_media_group_id");

