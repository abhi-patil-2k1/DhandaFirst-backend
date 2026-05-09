-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('owner', 'admin', 'member');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM (
  'sync_business_initial',
  'sync_business_incremental',
  'sync_reviews_page',
  'sync_posts_page',
  'sync_metrics_range',
  'generate_ai_reply',
  'send_report'
);

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('pending', 'syncing', 'completed', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'member',
    "googleAccessToken" TEXT,
    "googleRefreshToken" TEXT,
    "googleTokenExpiry" TIMESTAMP(3),
    "googleScopes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "businesses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "googleAccountId" TEXT NOT NULL,
    "googleLocationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "category" TEXT,
    "averageRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalReviews" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "googleReviewId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorPhotoUrl" TEXT,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "replyComment" TEXT,
    "repliedAt" TIMESTAMP(3),
    "aiSuggestedReply" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_posts" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "googlePostId" TEXT NOT NULL,
    "languageCode" TEXT,
    "summary" TEXT,
    "topicType" TEXT,
    "state" TEXT,
    "searchUrl" TEXT,
    "callToActionType" TEXT,
    "callToActionUrl" TEXT,
    "eventTitle" TEXT,
    "offerTitle" TEXT,
    "publishedAt" TIMESTAMP(3),
    "updatedAtSource" TIMESTAMP(3),
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_metric_daily" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "metricLabel" TEXT,
    "subEntityType" TEXT NOT NULL DEFAULT 'ALL',
    "date" TIMESTAMP(3) NOT NULL,
    "value" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_metric_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_sync_states" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "initialSyncStatus" "SyncStatus" NOT NULL DEFAULT 'pending',
    "reviewsSyncStatus" "SyncStatus" NOT NULL DEFAULT 'pending',
    "postsSyncStatus" "SyncStatus" NOT NULL DEFAULT 'pending',
    "metricsSyncStatus" "SyncStatus" NOT NULL DEFAULT 'pending',
    "initialSyncMonths" INTEGER NOT NULL DEFAULT 3,
    "lastReviewSyncAt" TIMESTAMP(3),
    "lastPostSyncAt" TIMESTAMP(3),
    "lastMetricSyncAt" TIMESTAMP(3),
    "reviewsBackfilledAt" TIMESTAMP(3),
    "postsBackfilledAt" TIMESTAMP(3),
    "metricsBackfilledAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_sync_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'pending',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "error" TEXT,
    "userId" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dedupeKey" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "autoReplyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "emailNotifications" BOOLEAN NOT NULL DEFAULT true,
    "theme" TEXT NOT NULL DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "businesses_userId_googleLocationId_key" ON "businesses"("userId", "googleLocationId");

-- CreateIndex
CREATE INDEX "businesses_userId_idx" ON "businesses"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_googleReviewId_key" ON "reviews"("googleReviewId");

-- CreateIndex
CREATE INDEX "reviews_businessId_idx" ON "reviews"("businessId");

-- CreateIndex
CREATE INDEX "reviews_businessId_repliedAt_idx" ON "reviews"("businessId", "repliedAt");

-- CreateIndex
CREATE INDEX "reviews_reviewedAt_idx" ON "reviews"("reviewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "business_posts_googlePostId_key" ON "business_posts"("googlePostId");

-- CreateIndex
CREATE INDEX "business_posts_businessId_publishedAt_idx" ON "business_posts"("businessId", "publishedAt");

-- CreateIndex
CREATE INDEX "business_posts_businessId_updatedAtSource_idx" ON "business_posts"("businessId", "updatedAtSource");

-- CreateIndex
CREATE UNIQUE INDEX "business_metric_daily_businessId_metric_subEntityType_date_key"
ON "business_metric_daily"("businessId", "metric", "subEntityType", "date");

-- CreateIndex
CREATE INDEX "business_metric_daily_businessId_date_idx" ON "business_metric_daily"("businessId", "date");

-- CreateIndex
CREATE INDEX "business_metric_daily_businessId_metric_date_idx" ON "business_metric_daily"("businessId", "metric", "date");

-- CreateIndex
CREATE UNIQUE INDEX "business_sync_states_businessId_key" ON "business_sync_states"("businessId");

-- CreateIndex
CREATE INDEX "jobs_status_type_idx" ON "jobs"("status", "type");

-- CreateIndex
CREATE INDEX "jobs_status_runAt_idx" ON "jobs"("status", "runAt");

-- CreateIndex
CREATE INDEX "jobs_dedupeKey_idx" ON "jobs"("dedupeKey");

-- CreateIndex
CREATE INDEX "jobs_userId_idx" ON "jobs"("userId");

-- CreateIndex
CREATE INDEX "jobs_createdAt_idx" ON "jobs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_settings_userId_key" ON "user_settings"("userId");

-- AddForeignKey
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_posts" ADD CONSTRAINT "business_posts_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_metric_daily" ADD CONSTRAINT "business_metric_daily_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_sync_states" ADD CONSTRAINT "business_sync_states_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
