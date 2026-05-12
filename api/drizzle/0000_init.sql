CREATE TYPE "public"."joke_source" AS ENUM('human', 'bot');--> statement-breakpoint
CREATE TABLE "joke_memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt" text NOT NULL,
	"punchline" text NOT NULL,
	"prompt_normalized" text NOT NULL,
	"fingerprint" text NOT NULL,
	"prompt_embedding" vector(1024),
	"embedding_model" text,
	"votes_for" integer DEFAULT 0 NOT NULL,
	"votes_against" integer DEFAULT 0 NOT NULL,
	"vote_share" real DEFAULT 0.5 NOT NULL,
	"quality_score" real DEFAULT 0 NOT NULL,
	"rating_average" real,
	"rating_sum" real,
	"rating_count" integer,
	"admin_score" smallint,
	"admin_scored_by" text,
	"admin_scored_at" timestamp with time zone,
	"admin_comment" text,
	"used_as_example_count" integer DEFAULT 0 NOT NULL,
	"last_used_as_example_at" timestamp with time zone,
	"author_user_id" text,
	"author_real_name" text,
	"source" "joke_source" NOT NULL,
	"room_code" text NOT NULL,
	"round_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_starter_completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_starter_id" uuid NOT NULL,
	"punchline" text NOT NULL,
	"source" "joke_source" NOT NULL,
	"votes_for" integer DEFAULT 0 NOT NULL,
	"votes_against" integer DEFAULT 0 NOT NULL,
	"vote_share" real DEFAULT 0.5 NOT NULL,
	"rating_average" real,
	"rating_count" integer,
	"room_code" text NOT NULL,
	"round_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_starters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"is_golden" boolean DEFAULT false NOT NULL,
	"average_completion_rating" real,
	"average_vote_share" real,
	"golden_since" timestamp with time zone,
	"quick_feedback_up" integer DEFAULT 0 NOT NULL,
	"quick_feedback_down" integer DEFAULT 0 NOT NULL,
	"quick_feedback_broken" integer DEFAULT 0 NOT NULL,
	"feedback_score" real DEFAULT 0 NOT NULL,
	"admin_score" smallint,
	"admin_scored_by" text,
	"admin_scored_at" timestamp with time zone,
	"admin_comment" text,
	"derived_score" real,
	"used_as_example_count" integer DEFAULT 0 NOT NULL,
	"last_used_as_example_at" timestamp with time zone,
	"text_embedding" vector(1024),
	"embedding_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prompt_starter_completions" ADD CONSTRAINT "prompt_starter_completions_prompt_starter_id_prompt_starters_id_fk" FOREIGN KEY ("prompt_starter_id") REFERENCES "public"."prompt_starters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "joke_memory_fingerprint_unique" ON "joke_memory" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "joke_memory_embedding_hnsw_idx" ON "joke_memory" USING hnsw ("prompt_embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "joke_memory_created_at_idx" ON "joke_memory" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "joke_memory_admin_score_idx" ON "joke_memory" USING btree ("admin_score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "joke_memory_rating_idx" ON "joke_memory" USING btree ("rating_average" DESC NULLS LAST,"rating_count" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "joke_memory_author_idx" ON "joke_memory" USING btree ("author_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "joke_memory_source_idx" ON "joke_memory" USING btree ("source","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "completions_by_prompt_vote_share" ON "prompt_starter_completions" USING btree ("prompt_starter_id","vote_share" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "completions_by_prompt_created" ON "prompt_starter_completions" USING btree ("prompt_starter_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_starters_text_unique" ON "prompt_starters" USING btree ("text");--> statement-breakpoint
CREATE INDEX "prompt_starters_embedding_hnsw_idx" ON "prompt_starters" USING hnsw ("text_embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "prompt_starters_used_count_idx" ON "prompt_starters" USING btree ("used_count");--> statement-breakpoint
CREATE INDEX "prompt_starters_golden_idx" ON "prompt_starters" USING btree ("is_golden","average_completion_rating" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "prompt_starters_admin_idx" ON "prompt_starters" USING btree ("admin_score" DESC NULLS LAST,"created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "prompt_starters_feedback_idx" ON "prompt_starters" USING btree ("feedback_score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "prompt_starters_derived_idx" ON "prompt_starters" USING btree ("derived_score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "prompt_starters_used_as_example_idx" ON "prompt_starters" USING btree ("used_as_example_count");