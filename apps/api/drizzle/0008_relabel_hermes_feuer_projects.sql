-- Hermes and Feuer rows have been carrying the daemon's invocation channel
-- ('cron' / 'cli' / …) in the `project` column, because the collector used to
-- map Hermes session.source → project. The collector now sets project to the
-- repo name ('hermes-agent' / 'prometheus-feuer-agent') and the invocation
-- channel to `sub_tool`. Mirror that here so existing rows match the new shape
-- without waiting on the next 15-min sync (and so a row that never gets
-- re-synced still lands correctly).
UPDATE "argo"."usage_record"
SET
  "sub_tool" = COALESCE("sub_tool", "project"),
  "project" = CASE "source"
    WHEN 'hermes' THEN 'hermes-agent'
    WHEN 'feuer' THEN 'prometheus-feuer-agent'
  END
WHERE "source" IN ('hermes', 'feuer');
