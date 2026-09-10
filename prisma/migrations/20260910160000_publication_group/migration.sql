-- Identifiant d'envoi, partagé par les publications sœurs d'un même geste
-- multi-canal. Les lignes existantes deviennent chacune leur propre groupe:
-- elles ont été créées avant que la notion existe, et rien ne permet de les
-- rapprocher après coup sans risquer de fusionner des envois distincts.
ALTER TABLE "Publication" ADD COLUMN "groupId" TEXT;
UPDATE "Publication" SET "groupId" = id WHERE "groupId" IS NULL;
ALTER TABLE "Publication" ALTER COLUMN "groupId" SET NOT NULL;

CREATE INDEX "Publication_groupId_idx" ON "Publication"("groupId");
