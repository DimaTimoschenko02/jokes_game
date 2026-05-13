CREATE TYPE "public"."user_role" AS ENUM('admin', 'user');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" "user_role" DEFAULT 'user' NOT NULL;--> statement-breakpoint
UPDATE "users" SET "role" = 'admin' WHERE LOWER("login") = 'dimon';
