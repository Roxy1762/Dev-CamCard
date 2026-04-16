-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "rulesetVersion" TEXT NOT NULL,
    "contentSets" TEXT[],
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "winner" INTEGER,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchPlayer" (
    "id" SERIAL NOT NULL,
    "matchId" TEXT NOT NULL,
    "side" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "MatchPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchEvent" (
    "id" SERIAL NOT NULL,
    "matchId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "ts" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "side" INTEGER,
    "data" JSONB,

    CONSTRAINT "MatchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MatchPlayer_matchId_idx" ON "MatchPlayer"("matchId");

-- CreateIndex
CREATE INDEX "MatchEvent_matchId_seq_idx" ON "MatchEvent"("matchId", "seq");

-- AddForeignKey
ALTER TABLE "MatchPlayer" ADD CONSTRAINT "MatchPlayer_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
