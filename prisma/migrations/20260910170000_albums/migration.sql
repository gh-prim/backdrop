-- CreateTable
CREATE TABLE "Album" (
    "id" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Album_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlbumItem" (
    "id" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "AlbumItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Album_personaId_idx" ON "Album"("personaId");

-- CreateIndex
CREATE UNIQUE INDEX "Album_personaId_name_key" ON "Album"("personaId", "name");

-- CreateIndex
CREATE INDEX "AlbumItem_albumId_idx" ON "AlbumItem"("albumId");

-- CreateIndex
CREATE INDEX "AlbumItem_assetId_idx" ON "AlbumItem"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "AlbumItem_albumId_assetId_key" ON "AlbumItem"("albumId", "assetId");

-- AddForeignKey
ALTER TABLE "Album" ADD CONSTRAINT "Album_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlbumItem" ADD CONSTRAINT "AlbumItem_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlbumItem" ADD CONSTRAINT "AlbumItem_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

