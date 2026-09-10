-- Un état terminal de plus: la simulation ne doit jamais se confondre avec un
-- envoi réel dans la liste des publications.
ALTER TYPE "PubStatus" ADD VALUE IF NOT EXISTS 'DRY_RUN';

-- AlterTable
ALTER TABLE "Publication" ADD COLUMN "dryRun" BOOLEAN NOT NULL DEFAULT false;
