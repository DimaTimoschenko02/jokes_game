ALTER TABLE "joke_memory" ADD COLUMN "is_seed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "prompt_starters" ADD COLUMN "is_seed" boolean DEFAULT false NOT NULL;