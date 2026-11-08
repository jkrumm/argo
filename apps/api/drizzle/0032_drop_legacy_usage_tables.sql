-- Legacy usage tables: nothing reads or writes them since the move to the `usage` schema (cutover dump and nightly backups keep the data).
DROP TABLE IF EXISTS "argo"."account_pick" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "argo"."iu_portal_cost" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "argo"."iu_portal_total" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "argo"."quota_sample" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "argo"."usage_record" CASCADE;