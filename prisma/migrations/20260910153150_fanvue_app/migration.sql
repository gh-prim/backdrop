-- CreateTable
CREATE TABLE "FanvueApp" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "credentials" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FanvueApp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FanvueApp_organizationId_key" ON "FanvueApp"("organizationId");

-- AddForeignKey
ALTER TABLE "FanvueApp" ADD CONSTRAINT "FanvueApp_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
