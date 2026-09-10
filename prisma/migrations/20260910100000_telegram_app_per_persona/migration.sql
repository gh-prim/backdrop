-- DropForeignKey
ALTER TABLE "TelegramApp" DROP CONSTRAINT "TelegramApp_organizationId_fkey";

-- DropIndex
DROP INDEX "TelegramApp_organizationId_key";

-- AlterTable
ALTER TABLE "TelegramApp" DROP COLUMN "organizationId",
ADD COLUMN     "personaId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "TelegramApp_personaId_key" ON "TelegramApp"("personaId");

-- AddForeignKey
ALTER TABLE "TelegramApp" ADD CONSTRAINT "TelegramApp_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

