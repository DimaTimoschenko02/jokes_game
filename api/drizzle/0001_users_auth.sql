CREATE TYPE "public"."user_gender" AS ENUM('male', 'female', 'non-binary', 'not-specified');--> statement-breakpoint
CREATE TABLE "user_memory" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"themes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"voter_preferences" jsonb DEFAULT '{"darkPreference":0.5,"callbackPreference":0.5,"absurdPreference":0.5,"ironyPreference":0.5}'::jsonb NOT NULL,
	"author_style" jsonb DEFAULT '{"avgPunchlineLength":0,"preferredStructures":[]}'::jsonb NOT NULL,
	"portrait" text,
	"updated_after_rounds_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"login" text NOT NULL,
	"password_hash" text NOT NULL,
	"real_name" text NOT NULL,
	"display_name" text NOT NULL,
	"gender" "user_gender" DEFAULT 'not-specified' NOT NULL,
	"bio" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_memory" ADD CONSTRAINT "user_memory_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_login_unique" ON "users" USING btree ("login");--> statement-breakpoint
CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at" DESC NULLS LAST);