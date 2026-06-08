CREATE TABLE IF NOT EXISTS "argo"."hermes_message" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payload" jsonb,
	"status" text DEFAULT 'complete' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "argo"."hermes_thread" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"session_key" text NOT NULL,
	"title" text,
	"status" text DEFAULT 'active' NOT NULL,
	"pinned" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "argo"."hermes_message" ADD CONSTRAINT "hermes_message_thread_id_hermes_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "argo"."hermes_thread"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_hermes_message_thread_created" ON "argo"."hermes_message" USING btree ("thread_id","created_at");