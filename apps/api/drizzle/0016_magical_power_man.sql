CREATE TABLE IF NOT EXISTS "argo"."workout_draft" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"state" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
