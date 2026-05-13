ALTER TABLE "prompt_starters" DROP COLUMN IF EXISTS "quick_feedback_up";--> statement-breakpoint
ALTER TABLE "prompt_starters" DROP COLUMN IF EXISTS "quick_feedback_down";--> statement-breakpoint
ALTER TABLE "prompt_starters" DROP COLUMN IF EXISTS "quick_feedback_broken";--> statement-breakpoint
ALTER TABLE "prompt_starters" ADD COLUMN "feedback_sum" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "prompt_starters" ADD COLUMN "feedback_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "prompt_starters" SET "feedback_score" = 0;
