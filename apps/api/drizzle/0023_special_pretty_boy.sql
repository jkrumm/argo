CREATE TABLE IF NOT EXISTS "argo"."account_pick" (
	"id" serial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"lane" text NOT NULL,
	"picked" text NOT NULL,
	"reason" text NOT NULL,
	"stale" boolean NOT NULL,
	"snapshot" jsonb NOT NULL,
	"machine" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "argo"."quota_sample" (
	"id" serial PRIMARY KEY NOT NULL,
	"account" text NOT NULL,
	"sampled_at" timestamp with time zone NOT NULL,
	"machine" text NOT NULL,
	"five_hour_pct" double precision,
	"seven_day_pct" double precision,
	"five_hour_resets_at" timestamp with time zone,
	"seven_day_resets_at" timestamp with time zone,
	"auth_ok" boolean NOT NULL,
	"exhausted_until" timestamp with time zone,
	"source" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_account_pick_ts_lane_machine" ON "argo"."account_pick" USING btree ("ts","lane","machine");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_quota_sample_account_at_machine" ON "argo"."quota_sample" USING btree ("account","sampled_at","machine");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_quota_sample_sampled_at" ON "argo"."quota_sample" USING btree ("sampled_at");