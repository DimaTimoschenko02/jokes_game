-- Adds is_fallback flag on prompt_starters.
-- When the opening-generator agent fails or times out, the game uses these
-- rows as a deterministic backup pool instead of the static SEED_PROMPTS array.

ALTER TABLE "prompt_starters" ADD COLUMN "is_fallback" boolean NOT NULL DEFAULT false;--> statement-breakpoint

-- Promote the curated seed openings (admin-scored) to the fallback pool
-- so a fresh DB still has something to fall back to when the agent fails.
UPDATE "prompt_starters" SET "is_fallback" = true WHERE "is_seed" = true AND "admin_score" IS NOT NULL;
