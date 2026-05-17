CREATE TABLE IF NOT EXISTS "argo"."walking_pad_sessions" (
	"uuid" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"duration_s" integer NOT NULL,
	"distance_m" real NOT NULL,
	"steps" integer NOT NULL,
	"avg_speed_kmh" real NOT NULL,
	"max_speed_kmh" real NOT NULL,
	"kcal" real NOT NULL,
	"pause_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_walking_pad_sessions_started_at" ON "argo"."walking_pad_sessions" USING btree ("started_at");