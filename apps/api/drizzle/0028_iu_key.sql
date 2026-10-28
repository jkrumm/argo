-- IU spend per API key. Each key has its own rolling 30-day cap in IU's portal, so the key joins the
-- portal tables' primary keys (an athena-team cell must never overwrite the personal cell of the same
-- day and label) and tags usage_record rows. Every row that exists today belongs to the personal key:
-- the DEFAULT backfills the portal tables, the UPDATE tags billing='iu' usage rows. Other billings stay NULL;
-- after this a NULL iu_key on an iu row means "unknown key" (see lib/iu-keys.ts).
ALTER TABLE "argo"."usage_record" ADD COLUMN IF NOT EXISTS "iu_key" text;--> statement-breakpoint
UPDATE "argo"."usage_record" SET "iu_key" = 'personal' WHERE "billing" = 'iu' AND "iu_key" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_iu_key" ON "argo"."usage_record" USING btree ("iu_key");--> statement-breakpoint
ALTER TABLE "argo"."iu_portal_cost" ADD COLUMN IF NOT EXISTS "iu_key" text DEFAULT 'personal' NOT NULL;--> statement-breakpoint
ALTER TABLE "argo"."iu_portal_total" ADD COLUMN IF NOT EXISTS "iu_key" text DEFAULT 'personal' NOT NULL;--> statement-breakpoint
ALTER TABLE "argo"."iu_portal_cost" DROP CONSTRAINT IF EXISTS "iu_portal_cost_day_label_row_pk";--> statement-breakpoint
ALTER TABLE "argo"."iu_portal_total" DROP CONSTRAINT IF EXISTS "iu_portal_total_pkey";--> statement-breakpoint
ALTER TABLE "argo"."iu_portal_cost" ADD CONSTRAINT "iu_portal_cost_iu_key_day_label_row_pk" PRIMARY KEY("iu_key","day","label","row");--> statement-breakpoint
ALTER TABLE "argo"."iu_portal_total" ADD CONSTRAINT "iu_portal_total_iu_key_month_pk" PRIMARY KEY("iu_key","month");
