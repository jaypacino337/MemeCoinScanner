-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('TIKTOK', 'INSTAGRAM', 'X');

-- CreateEnum
CREATE TYPE "MetricSource" AS ENUM ('OFFICIAL_API', 'PUBLIC_PAGE', 'THIRD_PARTY_AGGREGATOR', 'SYNTHETIC_FIXTURE', 'ESTIMATED');

-- CreateEnum
CREATE TYPE "ConfidenceLevel" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'UNVERIFIED');

-- CreateEnum
CREATE TYPE "LinkHealth" AS ENUM ('OK', 'REDIRECTED', 'UNREACHABLE', 'NOT_ORIGINAL', 'ACCOUNT_MISMATCH', 'ACCESS_RESTRICTED', 'UNCHECKED');

-- CreateEnum
CREATE TYPE "VerificationState" AS ENUM ('VERIFIED', 'PARTIALLY_VERIFIED', 'UNVERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ContentCategory" AS ENUM ('ANIMAL', 'CAT_OR_DOG', 'CHARACTER', 'VISUAL_JOKE', 'CATCHPHRASE', 'SLANG', 'BRAINROT', 'SPORTS_REACTION', 'AI_MEME', 'NEWS_MOMENT', 'TRANSFORMATION', 'CHALLENGE', 'DANCE', 'FOOD', 'OTHER');

-- CreateEnum
CREATE TYPE "ScreeningStatus" AS ENUM ('CLEAN', 'DUST_ONLY', 'OCCUPIED', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "TokenQuality" AS ENUM ('GENUINE', 'ABANDONED', 'DUST_LAUNCH', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MomentumTrend" AS ENUM ('ACCELERATING', 'STEADY', 'DECAYING', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "HealthState" AS ENUM ('HEALTHY', 'DEGRADED', 'RATE_LIMITED', 'CREDENTIALS_MISSING', 'DOWN');

-- CreateEnum
CREATE TYPE "RiskKind" AS ENUM ('COPYRIGHT', 'IDENTITY', 'AFFILIATION', 'TRAGEDY', 'POLITICS', 'WEAK_SOURCING', 'SPONSORED', 'MINOR_SUBJECT', 'ADULT_CONTENT');

-- CreateEnum
CREATE TYPE "RiskSeverity" AS ENUM ('INFO', 'FLAG', 'EXCLUDE');

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "handle" TEXT NOT NULL,
    "displayName" TEXT,
    "profileUrl" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "followerCount" INTEGER,
    "verifiedAccount" BOOLEAN NOT NULL DEFAULT false,
    "primaryLanguage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPost" (
    "id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "platformPostId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "caption" TEXT,
    "thumbnailUrl" TEXT,
    "embedUrl" TEXT,
    "embedAllowed" BOOLEAN NOT NULL DEFAULT false,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "language" TEXT,
    "englishCommentRatio" DOUBLE PRECISION,
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricSnapshot" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "views" BIGINT,
    "likes" BIGINT,
    "comments" BIGINT,
    "shares" BIGINT,
    "saves" BIGINT,
    "followerCount" INTEGER,
    "source" "MetricSource" NOT NULL,
    "confidence" "ConfidenceLevel" NOT NULL,
    "rawHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViralCandidate" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "scanRunId" TEXT,
    "category" "ContentCategory" NOT NULL,
    "memeHook" TEXT NOT NULL,
    "whyItLands" TEXT NOT NULL,
    "mascotDirection" TEXT NOT NULL,
    "similarHistoricalMemes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "communityContentIdeas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "viralityScore" DOUBLE PRECISION NOT NULL,
    "recencyScore" DOUBLE PRECISION NOT NULL,
    "clarityScore" DOUBLE PRECISION NOT NULL,
    "mascotScore" DOUBLE PRECISION NOT NULL,
    "pfpScore" DOUBLE PRECISION NOT NULL,
    "englishScore" DOUBLE PRECISION NOT NULL,
    "originalityScore" DOUBLE PRECISION NOT NULL,
    "cleanScreenScore" DOUBLE PRECISION NOT NULL,
    "penaltyTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "opportunityScore" DOUBLE PRECISION NOT NULL,
    "memeabilityScore" DOUBLE PRECISION NOT NULL,
    "freshnessScore" DOUBLE PRECISION NOT NULL,
    "pfpPotentialScore" DOUBLE PRECISION NOT NULL,
    "verificationState" "VerificationState" NOT NULL DEFAULT 'UNVERIFIED',
    "linkHealth" "LinkHealth" NOT NULL DEFAULT 'UNCHECKED',
    "lastVerifiedAt" TIMESTAMP(3),
    "metricSource" "MetricSource" NOT NULL,
    "confidence" "ConfidenceLevel" NOT NULL,
    "momentum" "MomentumTrend" NOT NULL DEFAULT 'UNKNOWN',
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "exclusionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ViralCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenConcept" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "screeningStatus" "ScreeningStatus" NOT NULL DEFAULT 'UNCERTAIN',
    "searchedQueries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "searchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenConcept_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenSearchResult" (
    "id" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "matchType" TEXT NOT NULL,
    "mintAddress" TEXT,
    "tokenName" TEXT NOT NULL,
    "tokenTicker" TEXT NOT NULL,
    "tokenUrl" TEXT,
    "marketCapUsd" DOUBLE PRECISION,
    "athMarketCapUsd" DOUBLE PRECISION,
    "createdOnIndexAt" TIMESTAMP(3),
    "holders" INTEGER,
    "quality" "TokenQuality" NOT NULL DEFAULT 'UNKNOWN',
    "source" "MetricSource" NOT NULL,
    "confidence" "ConfidenceLevel" NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenSearchResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskNote" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "kind" "RiskKind" NOT NULL,
    "severity" "RiskSeverity" NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformProviderRecord" (
    "id" TEXT NOT NULL,
    "platformKey" TEXT NOT NULL,
    "adapterName" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "requiresCredential" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformProviderRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanRun" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" "ScanStatus" NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "platforms" "Platform"[] DEFAULT ARRAY[]::"Platform"[],
    "filters" JSONB,
    "postsSeen" INTEGER NOT NULL DEFAULT 0,
    "postsAccepted" INTEGER NOT NULL DEFAULT 0,
    "postsRejected" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "ScanRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedIdea" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedIdea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rejection" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rejection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSourceHealth" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "state" "HealthState" NOT NULL DEFAULT 'HEALTHY',
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastError" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "rateLimitResetAt" TIMESTAMP(3),
    "requestsToday" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataSourceHealth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CacheEntry" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CacheEntry_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "SocialAccount_platform_followerCount_idx" ON "SocialAccount"("platform", "followerCount");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_platform_handle_key" ON "SocialAccount"("platform", "handle");

-- CreateIndex
CREATE INDEX "SocialPost_platform_postedAt_idx" ON "SocialPost"("platform", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SocialPost_platform_platformPostId_key" ON "SocialPost"("platform", "platformPostId");

-- CreateIndex
CREATE INDEX "MetricSnapshot_postId_capturedAt_idx" ON "MetricSnapshot"("postId", "capturedAt");

-- CreateIndex
CREATE INDEX "ViralCandidate_opportunityScore_idx" ON "ViralCandidate"("opportunityScore");

-- CreateIndex
CREATE INDEX "ViralCandidate_scanRunId_idx" ON "ViralCandidate"("scanRunId");

-- CreateIndex
CREATE INDEX "TokenConcept_candidateId_idx" ON "TokenConcept"("candidateId");

-- CreateIndex
CREATE INDEX "TokenConcept_ticker_idx" ON "TokenConcept"("ticker");

-- CreateIndex
CREATE INDEX "TokenSearchResult_conceptId_idx" ON "TokenSearchResult"("conceptId");

-- CreateIndex
CREATE INDEX "RiskNote_candidateId_idx" ON "RiskNote"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformProviderRecord_platformKey_key" ON "PlatformProviderRecord"("platformKey");

-- CreateIndex
CREATE INDEX "ScanRun_startedAt_idx" ON "ScanRun"("startedAt");

-- CreateIndex
CREATE INDEX "Job_queue_status_runAt_idx" ON "Job"("queue", "status", "runAt");

-- CreateIndex
CREATE UNIQUE INDEX "SavedIdea_candidateId_key" ON "SavedIdea"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "Rejection_candidateId_key" ON "Rejection"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "DataSourceHealth_sourceKey_key" ON "DataSourceHealth"("sourceKey");

-- CreateIndex
CREATE INDEX "DataSourceHealth_state_idx" ON "DataSourceHealth"("state");

-- CreateIndex
CREATE INDEX "CacheEntry_expiresAt_idx" ON "CacheEntry"("expiresAt");

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSnapshot" ADD CONSTRAINT "MetricSnapshot_postId_fkey" FOREIGN KEY ("postId") REFERENCES "SocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViralCandidate" ADD CONSTRAINT "ViralCandidate_postId_fkey" FOREIGN KEY ("postId") REFERENCES "SocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViralCandidate" ADD CONSTRAINT "ViralCandidate_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "ScanRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenConcept" ADD CONSTRAINT "TokenConcept_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "ViralCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenSearchResult" ADD CONSTRAINT "TokenSearchResult_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "TokenConcept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskNote" ADD CONSTRAINT "RiskNote_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "ViralCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedIdea" ADD CONSTRAINT "SavedIdea_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "ViralCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rejection" ADD CONSTRAINT "Rejection_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "ViralCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
