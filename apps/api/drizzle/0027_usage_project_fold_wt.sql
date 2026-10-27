-- A sibling worktree folder (`shutterflow-wt`) is its repo: fold the suffix in history, the same
-- rule normalizeProject applies on ingest from now on. Only touches project; no key uses it.
UPDATE "argo"."usage_record" SET "project" = regexp_replace("project", '-wt$', '') WHERE "project" ~ '.-wt$';
