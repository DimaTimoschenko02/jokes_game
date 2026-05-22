CREATE TABLE "group_memory" (
	"id" text PRIMARY KEY NOT NULL,
	"themes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"in_jokes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"triggers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"avoided_themes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"setup_patterns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary_text" text,
	"games_processed" integer DEFAULT 0 NOT NULL,
	"summary_refreshed_at_game" integer DEFAULT 0 NOT NULL,
	"memory_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "test_account" boolean DEFAULT false NOT NULL;