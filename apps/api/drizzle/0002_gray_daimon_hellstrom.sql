CREATE TABLE IF NOT EXISTS "argo"."walking_pad_achievements" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "argo"."walking_pad_achievements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"type" text NOT NULL,
	"session_uuid" text,
	"value" real,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"confetti" integer DEFAULT 1 NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_walking_pad_achievements_unlocked_at" ON "argo"."walking_pad_achievements" USING btree ("unlocked_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_walking_pad_achievements_type" ON "argo"."walking_pad_achievements" USING btree ("type");