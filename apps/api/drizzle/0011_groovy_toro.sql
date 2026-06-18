CREATE TABLE IF NOT EXISTS "argo"."book" (
	"hardcover_book_id" integer PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"slug" text,
	"headline" text,
	"authors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"genres" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pages" integer,
	"release_year" integer,
	"description" text,
	"cover_url" text,
	"synced_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "argo"."book_sync_map" (
	"book_key" text PRIMARY KEY NOT NULL,
	"hardcover_book_id" integer,
	"hardcover_edition_id" integer,
	"confirmed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "argo"."reading_stat" (
	"book_key" text PRIMARY KEY NOT NULL,
	"title" text,
	"author" text,
	"total_read_seconds" integer DEFAULT 0 NOT NULL,
	"pages_read" integer DEFAULT 0 NOT NULL,
	"current_percent" real DEFAULT 0 NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"last_read_at" timestamp with time zone,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "argo"."user_book" (
	"hardcover_user_book_id" integer PRIMARY KEY NOT NULL,
	"hardcover_book_id" integer NOT NULL,
	"status_id" integer NOT NULL,
	"rating" real,
	"review_raw" text,
	"has_review" integer DEFAULT 0 NOT NULL,
	"first_started_reading_date" text,
	"first_read_date" text,
	"last_read_date" text,
	"date_added" text,
	"edition_id" integer,
	"hardcover_updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "argo"."user_book" ADD CONSTRAINT "user_book_hardcover_book_id_book_hardcover_book_id_fk" FOREIGN KEY ("hardcover_book_id") REFERENCES "argo"."book"("hardcover_book_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
