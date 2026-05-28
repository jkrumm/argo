-- Re-classify usage rows whose workspace is fixed by their collector
-- (regardless of project path). Mirrors the source overrides in
-- classifyWorkspace(): feuer → work; hermes / opencode / audio-proxy →
-- private. Applies even when 0006 already assigned a value, because
-- the previous backfill misclassified feuer rows (their project is a
-- generic 'cron' / 'cli', not the repo name).
UPDATE "argo"."usage_record"
SET "workspace" = CASE
  WHEN "source" = 'feuer' THEN 'work'
  WHEN "source" IN ('hermes', 'opencode', 'audio-proxy') THEN 'private'
  ELSE "workspace"
END
WHERE "source" IN ('feuer', 'hermes', 'opencode', 'audio-proxy');
