-- CreateTable
CREATE TABLE "TelegramApp" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "credentials" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramApp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramApp_organizationId_key" ON "TelegramApp"("organizationId");

-- AddForeignKey
ALTER TABLE "TelegramApp" ADD CONSTRAINT "TelegramApp_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
