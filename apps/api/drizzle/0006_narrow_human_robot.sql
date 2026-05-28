ALTER TABLE "argo"."usage_record" ADD COLUMN "workspace" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_workspace" ON "argo"."usage_record" USING btree ("workspace");--> statement-breakpoint
-- Heuristic backfill: paths were already collapsed to bare repo names by
-- 0005_normalize_projects, so classify by name. Mirrors classifyWorkspace().
UPDATE "argo"."usage_record"
SET "workspace" = CASE
  WHEN "project" IS NULL THEN NULL
  WHEN "project" ~* '^(epos[._]|prometheus[-_]|crm-bridge|cfn-kafka|terraform-monitoring)' THEN 'work'
  ELSE 'private'
END
WHERE "workspace" IS NULL AND "project" IS NOT NULL;