-- AddUniqueConstraint
ALTER TABLE "MatchPlayer" ADD CONSTRAINT "MatchPlayer_matchId_side_key" UNIQUE ("matchId", "side");
