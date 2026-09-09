-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('INSTAGRAM', 'TELEGRAM', 'FANVUE');

-- CreateEnum
CREATE TYPE "Rating" AS ENUM ('SFW', 'SUGGESTIVE', 'NSFW');

-- CreateEnum
CREATE TYPE "PubStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'MISSED');

-- CreateEnum
CREATE TYPE "PubKind" AS ENUM ('SINGLE', 'CAROUSEL', 'REEL', 'TG_PAID', 'FV_POST', 'FV_MASS_DM');

-- CreateEnum
CREATE TYPE "SubStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "Persona" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "audienceTimezone" TEXT,
    "bible" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Persona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelAccount" (
    "id" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "credentials" BYTEA NOT NULL,
    "maxRating" "Rating" NOT NULL,
    "scheduleToleranceMinutes" INTEGER,
    "tokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "rating" "Rating" NOT NULL,
    "localPath" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "mimeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Variant" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "ratio" TEXT NOT NULL,
    "localPath" TEXT NOT NULL,
    "r2Key" TEXT,
    "tgSourceMessageId" BIGINT,
    "fvMediaUuid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Variant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Publication" (
    "id" TEXT NOT NULL,
    "channelAccountId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "kind" "PubKind" NOT NULL,
    "copy" TEXT NOT NULL DEFAULT '',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "PubStatus" NOT NULL DEFAULT 'DRAFT',
    "starPrice" INTEGER,
    "priceCents" INTEGER,
    "audience" TEXT,
    "previewVariantId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "audioId" TEXT,
    "remoteId" TEXT,
    "failureReason" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationItem" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "childContainerId" TEXT,

    CONSTRAINT "PublicationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramSubscriber" (
    "id" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "tgUserId" BIGINT NOT NULL,
    "source" TEXT,
    "status" "SubStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramSubscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmCampaign" (
    "id" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "caption" TEXT NOT NULL DEFAULT '',
    "starPrice" INTEGER,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "PubStatus" NOT NULL DEFAULT 'DRAFT',
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DmCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmCampaignItem" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "DmCampaignItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmDelivery" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "messageId" BIGINT,
    "failReason" TEXT,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "DmDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricSnapshot" (
    "id" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "publicationId" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "MetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FanvueEarning" (
    "id" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "transactionOrderId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "grossCents" INTEGER NOT NULL,
    "netCents" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "postUuid" TEXT,
    "messageUuid" TEXT,
    "publicationId" TEXT,
    "reversedTransactionOrderId" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FanvueEarning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "activeOrganizationId" TEXT,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "metadata" TEXT,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inviterId" TEXT NOT NULL,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Persona_organizationId_idx" ON "Persona"("organizationId");

-- CreateIndex
CREATE INDEX "ChannelAccount_personaId_idx" ON "ChannelAccount"("personaId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelAccount_personaId_platform_externalId_key" ON "ChannelAccount"("personaId", "platform", "externalId");

-- CreateIndex
CREATE INDEX "Asset_personaId_idx" ON "Asset"("personaId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_personaId_sha256_key" ON "Asset"("personaId", "sha256");

-- CreateIndex
CREATE INDEX "Variant_assetId_idx" ON "Variant"("assetId");

-- CreateIndex
CREATE INDEX "Publication_channelAccountId_status_idx" ON "Publication"("channelAccountId", "status");

-- CreateIndex
CREATE INDEX "Publication_scheduledAt_idx" ON "Publication"("scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_channelAccountId_remoteId_key" ON "Publication"("channelAccountId", "remoteId");

-- CreateIndex
CREATE INDEX "PublicationItem_variantId_idx" ON "PublicationItem"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationItem_publicationId_position_key" ON "PublicationItem"("publicationId", "position");

-- CreateIndex
CREATE INDEX "TelegramSubscriber_personaId_status_idx" ON "TelegramSubscriber"("personaId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramSubscriber_personaId_tgUserId_key" ON "TelegramSubscriber"("personaId", "tgUserId");

-- CreateIndex
CREATE INDEX "DmCampaign_personaId_status_idx" ON "DmCampaign"("personaId", "status");

-- CreateIndex
CREATE INDEX "DmCampaign_scheduledAt_idx" ON "DmCampaign"("scheduledAt");

-- CreateIndex
CREATE INDEX "DmCampaignItem_variantId_idx" ON "DmCampaignItem"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "DmCampaignItem_campaignId_position_key" ON "DmCampaignItem"("campaignId", "position");

-- CreateIndex
CREATE INDEX "DmDelivery_campaignId_status_idx" ON "DmDelivery"("campaignId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DmDelivery_campaignId_subscriberId_key" ON "DmDelivery"("campaignId", "subscriberId");

-- CreateIndex
CREATE INDEX "MetricSnapshot_personaId_capturedAt_idx" ON "MetricSnapshot"("personaId", "capturedAt");

-- CreateIndex
CREATE INDEX "MetricSnapshot_publicationId_idx" ON "MetricSnapshot"("publicationId");

-- CreateIndex
CREATE INDEX "FanvueEarning_personaId_date_idx" ON "FanvueEarning"("personaId", "date");

-- CreateIndex
CREATE INDEX "FanvueEarning_postUuid_idx" ON "FanvueEarning"("postUuid");

-- CreateIndex
CREATE UNIQUE INDEX "FanvueEarning_personaId_transactionOrderId_key" ON "FanvueEarning"("personaId", "transactionOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "organization_slug_key" ON "organization"("slug");

-- CreateIndex
CREATE INDEX "member_organizationId_idx" ON "member"("organizationId");

-- CreateIndex
CREATE INDEX "member_userId_idx" ON "member"("userId");

-- CreateIndex
CREATE INDEX "invitation_organizationId_idx" ON "invitation"("organizationId");

-- CreateIndex
CREATE INDEX "invitation_email_idx" ON "invitation"("email");

-- AddForeignKey
ALTER TABLE "Persona" ADD CONSTRAINT "Persona_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelAccount" ADD CONSTRAINT "ChannelAccount_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Variant" ADD CONSTRAINT "Variant_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "ChannelAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationItem" ADD CONSTRAINT "PublicationItem_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationItem" ADD CONSTRAINT "PublicationItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramSubscriber" ADD CONSTRAINT "TelegramSubscriber_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmCampaign" ADD CONSTRAINT "DmCampaign_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmCampaign" ADD CONSTRAINT "DmCampaign_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmCampaignItem" ADD CONSTRAINT "DmCampaignItem_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "DmCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmCampaignItem" ADD CONSTRAINT "DmCampaignItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmDelivery" ADD CONSTRAINT "DmDelivery_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "DmCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmDelivery" ADD CONSTRAINT "DmDelivery_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "TelegramSubscriber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSnapshot" ADD CONSTRAINT "MetricSnapshot_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSnapshot" ADD CONSTRAINT "MetricSnapshot_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FanvueEarning" ADD CONSTRAINT "FanvueEarning_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
