-- CreateTable
CREATE TABLE "InstagramHashtag" (
    "id" TEXT NOT NULL,
    "channelAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hashtagId" TEXT,
    "topMedianLikes" INTEGER,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstagramHashtag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InstagramHashtag_channelAccountId_checkedAt_idx" ON "InstagramHashtag"("channelAccountId", "checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramHashtag_channelAccountId_name_key" ON "InstagramHashtag"("channelAccountId", "name");

-- AddForeignKey
ALTER TABLE "InstagramHashtag" ADD CONSTRAINT "InstagramHashtag_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "ChannelAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
