CREATE TABLE IF NOT EXISTS "argo"."iu_portal_cost" (
	"day" date NOT NULL,
	"label" text NOT NULL,
	"row" integer NOT NULL,
	"model" text,
	"cost_usd" double precision NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "iu_portal_cost_day_label_row_pk" PRIMARY KEY("day","label","row")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "argo"."iu_portal_total" (
	"month" text PRIMARY KEY NOT NULL,
	"total_usd" double precision NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
