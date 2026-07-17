ALTER TABLE "prompt_starters" ADD COLUMN "source" text DEFAULT 'ai' NOT NULL;--> statement-breakpoint
ALTER TABLE "prompt_starters" ADD COLUMN "author_user_id" text;