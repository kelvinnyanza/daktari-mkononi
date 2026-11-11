-- CreateEnum
CREATE TYPE "HealthTipCategory" AS ENUM ('NUTRITION', 'EXERCISE', 'WATER_HYGIENE', 'MENTAL_HEALTH', 'CHRONIC_DISEASE', 'MATERNAL_CHILD', 'MALARIA', 'PREVENTION');

-- CreateEnum
CREATE TYPE "HealthTipStatus" AS ENUM ('DRAFT', 'REVIEWED', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "HealthTip" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" "HealthTipCategory" NOT NULL,
    "titleSw" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "summarySw" TEXT NOT NULL,
    "summaryEn" TEXT NOT NULL,
    "bodySw" TEXT NOT NULL,
    "bodyEn" TEXT NOT NULL,
    "takeawaysSw" TEXT[],
    "takeawaysEn" TEXT[],
    "illustration" TEXT NOT NULL,
    "imageKey" TEXT,
    "sources" JSONB NOT NULL,
    "status" "HealthTipStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "publishAt" TIMESTAMP(3),
    "unpublishAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HealthTip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HealthTip_slug_key" ON "HealthTip"("slug");

-- CreateIndex
CREATE INDEX "HealthTip_status_publishAt_idx" ON "HealthTip"("status", "publishAt");

-- CreateIndex
CREATE INDEX "HealthTip_category_idx" ON "HealthTip"("category");

-- AddForeignKey
ALTER TABLE "HealthTip" ADD CONSTRAINT "HealthTip_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
